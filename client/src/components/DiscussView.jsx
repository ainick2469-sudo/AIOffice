import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChatRoom from './ChatRoom';
import OfficeBoard from './OfficeBoard';
import SplitPane from './layout/SplitPane';

const DEFAULT_PARTICIPANTS = [
  { id: 'builder', label: 'Builder' },
  { id: 'designer', label: 'Designer' },
  { id: 'architect', label: 'Architect' },
  { id: 'qa', label: 'QA' },
  { id: 'critic', label: 'Critic' },
];

const REQUIRED_BRAINSTORM_SECTIONS = ['goals', 'questions', 'decisions', 'next_steps'];

function projectIdFromName(projectName) {
  const safe = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  return safe.replace(/[^a-z0-9-]+/g, '-');
}

function participantsKey(projectName) {
  return `ai-office:discuss-participants:${projectIdFromName(projectName)}`;
}

function participantsCollapsedKey(projectName) {
  return `ai-office:discuss-participants-collapsed:${projectIdFromName(projectName)}`;
}

function boardOpenKey(projectName) {
  return `ai-office:discuss-board-open:${projectIdFromName(projectName)}`;
}

function boardStorageKey(projectName) {
  return `ai-office:office-board:${projectIdFromName(projectName)}`;
}

function boardAutoOpenSessionKey(projectName) {
  return `ai-office:discuss-board-autopen:${projectIdFromName(projectName)}`;
}

function specDraftStorageKey(projectName) {
  return `ai-office:spec-draft:${projectIdFromName(projectName)}`;
}

function specPanelDraftStorageKey(channel, projectName) {
  const safeChannel = String(channel || 'main').trim().toLowerCase() || 'main';
  const safeProject = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  return `ai-office:spec-draft:${safeChannel}:${safeProject}`;
}

function tasksDraftStorageKey(projectName) {
  return `ai-office:tasks-draft:${projectIdFromName(projectName)}`;
}

function normalizedSelection(source) {
  if (!Array.isArray(source) || source.length === 0) {
    return DEFAULT_PARTICIPANTS.map((item) => item.id);
  }
  const allowed = new Set(DEFAULT_PARTICIPANTS.map((item) => item.id));
  const filtered = source.filter((value) => allowed.has(value));
  return filtered.length > 0 ? filtered : DEFAULT_PARTICIPANTS.map((item) => item.id);
}

function storageRatioKey(projectName) {
  return `ai-office:discuss-layout-ratio:${projectIdFromName(projectName)}`;
}

function emptyBoard() {
  return {
    goals: '',
    questions: '',
    decisions: '',
    next_steps: '',
    risks: '',
  };
}

function normalizeBoard(rawBoard) {
  const source = rawBoard && typeof rawBoard === 'object' ? rawBoard : {};
  return {
    goals: String(source.goals || ''),
    questions: String(source.questions || ''),
    decisions: String(source.decisions || ''),
    next_steps: String(source.next_steps || ''),
    risks: String(source.risks || ''),
  };
}

function readBoard(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return emptyBoard();
    return normalizeBoard(JSON.parse(raw));
  } catch {
    return emptyBoard();
  }
}

function hasBoardContent(board) {
  return ['goals', 'questions', 'decisions', 'next_steps', 'risks'].some(
    (field) => String(board?.[field] || '').trim().length > 0
  );
}

function readParticipants(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return DEFAULT_PARTICIPANTS.map((item) => item.id);
    const parsed = JSON.parse(raw);
    return normalizedSelection(parsed);
  } catch {
    return DEFAULT_PARTICIPANTS.map((item) => item.id);
  }
}

function readRatio(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0.2 && parsed < 0.8) return parsed;
  } catch {
    // ignore storage errors
  }
  return 0.62;
}

function readBoolean(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === 'true';
  } catch {
    return fallback;
  }
}

function normalizeBullets(rawText) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return '';
  const bulletSource = lines
    .map((line) => line.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
    .filter(Boolean);
  return bulletSource.map((line) => `- ${line}`).join('\n');
}

function headingKey(rawHeading) {
  const normalized = String(rawHeading || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  if (normalized.includes('open question')) return 'questions';
  if (normalized.includes('goal')) return 'goals';
  if (normalized.includes('decision')) return 'decisions';
  if (normalized.includes('next action') || normalized.includes('next step')) return 'next_steps';
  if (normalized.includes('risk')) return 'risks';
  return '';
}

function parseStructuredBrainstorm(markdownText) {
  const text = String(markdownText || '').replace(/\r/g, '');
  const matches = [...text.matchAll(/^#{1,6}\s*(.+?)\s*$/gm)];
  if (matches.length === 0) {
    return { ok: false, sections: emptyBoard() };
  }

  const sections = emptyBoard();
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const heading = match[1] || '';
    const sectionKey = headingKey(heading);
    if (!sectionKey) continue;
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    const body = text.slice(start, end).trim();
    const bullets = normalizeBullets(body);
    if (bullets) {
      sections[sectionKey] = bullets;
    }
  }

  const requiredComplete = REQUIRED_BRAINSTORM_SECTIONS.every(
    (key) => String(sections[key] || '').trim().length > 0
  );
  return { ok: requiredComplete, sections };
}

function splitBulletLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
    .filter(Boolean);
}

function buildUserStory(goals) {
  const items = splitBulletLines(goals);
  if (items.length === 0) return 'As a user, I want a clear and useful product outcome aligned with the meeting goals.';
  const primary = items.slice(0, 2).join(' and ');
  return [
    `As a user, I want ${primary.toLowerCase()} so that I can complete the core outcome quickly.`,
    'As the team, we need a scoped first milestone that validates value before adding complexity.',
  ].join('\n');
}

function buildAcceptanceCriteria(goals, decisions) {
  const goalItems = splitBulletLines(goals).slice(0, 3).map((item) => `- [ ] ${item}`);
  const decisionItems = splitBulletLines(decisions).slice(0, 2).map((item) => `- [ ] Respect decision: ${item}`);
  const all = [...goalItems, ...decisionItems];
  if (all.length === 0) {
    return '- [ ] Core user flow works end-to-end\n- [ ] Key edge cases are addressed';
  }
  return all.join('\n');
}

function buildSpecDraft(projectName, board) {
  const title = String(projectName || 'ai-office').trim() || 'ai-office';
  const goals = normalizeBullets(board.goals);
  const questions = normalizeBullets(board.questions);
  const decisions = normalizeBullets(board.decisions);
  const nextActions = normalizeBullets(board.next_steps);
  const risks = normalizeBullets(board.risks);
  const acceptance = buildAcceptanceCriteria(goals, decisions);
  const userStory = buildUserStory(goals);

  return [
    `# ${title} Spec Draft`,
    '',
    '## Goal',
    goals || '- Define and deliver a clear first milestone',
    '',
    '## User Story',
    userStory,
    '',
    '## Constraints',
    decisions || '- Keep implementation aligned with agreed meeting decisions',
    '',
    '## Acceptance Criteria',
    acceptance,
    '',
    '## Open Questions',
    questions || '- No unresolved questions captured yet',
    '',
    '## Decisions',
    decisions || '- Decisions pending',
    '',
    '## Risks',
    risks || '- Risks pending review',
    '',
    '## Next Actions',
    nextActions || '- Define first implementation task',
  ].join('\n');
}

function buildTasksDraft(board) {
  const actionItems = splitBulletLines(board.next_steps).map((item) => `- [ ] ${item}`);
  const questionItems = splitBulletLines(board.questions).map((item) => `- [ ] Clarify: ${item}`);
  const merged = [...actionItems, ...questionItems];
  if (merged.length === 0) {
    return ['- [ ] Convert meeting output into first implementation tasks'].join('\n');
  }
  return merged.join('\n');
}

function latestAgentMessage(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const current = list[index];
    const sender = String(current?.sender || '').trim().toLowerCase();
    const content = String(current?.content || '').trim();
    if (!content) continue;
    if (sender === 'user') continue;
    return current;
  }
  return null;
}

export default function DiscussView({
  channel,
  projectName,
  beginnerMode = false,
  brainstormMessage,
  onRunBrainstorm,
  onStartBuilding,
  chatPrefill = '',
  onChatPrefillConsumed = null,
  onOpenTab = null,
}) {
  const participantStorage = useMemo(() => participantsKey(projectName), [projectName]);
  const participantCollapsedStorage = useMemo(
    () => participantsCollapsedKey(projectName),
    [projectName]
  );
  const boardOpenStorage = useMemo(() => boardOpenKey(projectName), [projectName]);
  const boardStorage = useMemo(() => boardStorageKey(projectName), [projectName]);
  const boardAutopenSession = useMemo(() => boardAutoOpenSessionKey(projectName), [projectName]);
  const ratioStorage = useMemo(() => storageRatioKey(projectName), [projectName]);
  const persistedParticipants = useMemo(() => readParticipants(participantStorage), [participantStorage]);
  const persistedRatio = useMemo(() => readRatio(ratioStorage), [ratioStorage]);
  const persistedParticipantsCollapsed = useMemo(
    () => readBoolean(participantCollapsedStorage, true),
    [participantCollapsedStorage]
  );
  const persistedBoardOpen = useMemo(
    () => readBoolean(boardOpenStorage, false),
    [boardOpenStorage]
  );

  const [participantOverrides, setParticipantOverrides] = useState({});
  const [ratioOverrides, setRatioOverrides] = useState({});
  const [participantCollapseOverrides, setParticipantCollapseOverrides] = useState({});
  const [boardOpenOverrides, setBoardOpenOverrides] = useState({});
  const [boardHasContent, setBoardHasContent] = useState(() => hasBoardContent(readBoard(boardStorage)));
  const [meetingNotice, setMeetingNotice] = useState('');
  const [brainstormPending, setBrainstormPending] = useState(false);
  const [brainstormParseWarning, setBrainstormParseWarning] = useState('');
  const [showBuildGuardModal, setShowBuildGuardModal] = useState(false);
  const latestMessagesRef = useRef([]);
  const brainstormBaselineMessageIdRef = useRef(null);
  const brainstormHandledMessageIdRef = useRef(null);

  const activeParticipants = participantOverrides[participantStorage] || persistedParticipants;
  const ratio = ratioOverrides[ratioStorage] ?? persistedRatio;
  const participantsCollapsed = participantCollapseOverrides[participantCollapsedStorage]
    ?? persistedParticipantsCollapsed;
  const boardOpen = boardOpenOverrides[boardOpenStorage] ?? persistedBoardOpen;

  const setParticipantsCollapsed = useCallback((nextValue) => {
    const normalized = Boolean(nextValue);
    setParticipantCollapseOverrides((prev) => ({ ...prev, [participantCollapsedStorage]: normalized }));
    try {
      localStorage.setItem(participantCollapsedStorage, normalized ? 'true' : 'false');
    } catch {
      // ignore storage failures
    }
  }, [participantCollapsedStorage]);

  const setBoardOpen = useCallback((nextValue) => {
    const normalized = Boolean(nextValue);
    setBoardOpenOverrides((prev) => ({ ...prev, [boardOpenStorage]: normalized }));
    try {
      localStorage.setItem(boardOpenStorage, normalized ? 'true' : 'false');
    } catch {
      // ignore storage failures
    }
  }, [boardOpenStorage]);

  const setBoardDraft = useCallback((nextBoard, { keepOpen = true } = {}) => {
    const normalized = normalizeBoard(nextBoard);
    try {
      localStorage.setItem(boardStorage, JSON.stringify(normalized));
    } catch {
      // ignore storage failures
    }
    const content = hasBoardContent(normalized);
    setBoardHasContent(content);
    if (keepOpen && content) {
      setBoardOpen(true);
    }
    window.dispatchEvent(
      new CustomEvent('office-board:replace', {
        detail: { projectName, board: normalized },
      })
    );
    window.dispatchEvent(
      new CustomEvent('office-board:updated', {
        detail: {
          projectName,
          hasContent: content,
        },
      })
    );
  }, [boardStorage, projectName, setBoardOpen]);

  useEffect(() => {
    const onBoardUpdated = (event) => {
      const detailProject = String(event?.detail?.projectName || '').trim().toLowerCase();
      const currentProject = String(projectName || 'ai-office').trim().toLowerCase();
      if (detailProject && detailProject !== currentProject) return;
      setBoardHasContent(Boolean(event?.detail?.hasContent));
    };
    window.addEventListener('office-board:updated', onBoardUpdated);
    return () => window.removeEventListener('office-board:updated', onBoardUpdated);
  }, [projectName]);

  useEffect(() => {
    setBoardHasContent(hasBoardContent(readBoard(boardStorage)));
  }, [boardStorage]);

  useEffect(() => {
    if (!boardHasContent || boardOpen) return;
    try {
      const alreadyAutoOpened = sessionStorage.getItem(boardAutopenSession) === 'true';
      if (alreadyAutoOpened) return;
      sessionStorage.setItem(boardAutopenSession, 'true');
      setBoardOpenOverrides((prev) => ({ ...prev, [boardOpenStorage]: true }));
      localStorage.setItem(boardOpenStorage, 'true');
    } catch {
      // ignore session/local storage failures
    }
  }, [boardAutopenSession, boardHasContent, boardOpen, boardOpenStorage]);

  useEffect(() => {
    if (!meetingNotice) return undefined;
    const timer = window.setTimeout(() => setMeetingNotice(''), 2600);
    return () => window.clearTimeout(timer);
  }, [meetingNotice]);

  const openWorkspaceTab = useCallback((tabId) => {
    const tab = String(tabId || '').trim().toLowerCase();
    if (!tab) return;
    onOpenTab?.(tab);
    window.dispatchEvent(new CustomEvent('workspace:open-tab', { detail: { tab } }));
  }, [onOpenTab]);

  const sendBoardToSpec = useCallback(({ openSpec = true } = {}) => {
    const board = readBoard(boardStorage);
    if (!hasBoardContent(board)) {
      setMeetingNotice('Meeting output is empty. Capture goals or run brainstorm first.');
      setBoardOpen(true);
      return false;
    }
    const specDraft = buildSpecDraft(projectName, board);
    const projectId = projectIdFromName(projectName);
    const now = new Date().toISOString();
    try {
      localStorage.setItem(specDraftStorageKey(projectId), specDraft);
      localStorage.setItem(
        specPanelDraftStorageKey(channel, projectName),
        JSON.stringify({
          updated_at: now,
          spec_md: specDraft,
          idea_bank_md: '',
        })
      );
    } catch {
      // ignore storage failures
    }
    setMeetingNotice('Meeting output sent to Spec draft.');
    if (openSpec) {
      openWorkspaceTab('spec');
    }
    return true;
  }, [boardStorage, channel, openWorkspaceTab, projectName, setBoardOpen]);

  const sendBoardToTasks = useCallback(() => {
    const board = readBoard(boardStorage);
    if (!hasBoardContent(board)) {
      setMeetingNotice('Meeting output is empty. Add next actions first.');
      setBoardOpen(true);
      return false;
    }
    const tasksDraft = buildTasksDraft(board);
    const projectId = projectIdFromName(projectName);
    try {
      localStorage.setItem(tasksDraftStorageKey(projectId), tasksDraft);
    } catch {
      // ignore storage failures
    }
    setMeetingNotice('Tasks draft prepared from meeting output.');
    openWorkspaceTab('tasks');
    return true;
  }, [boardStorage, openWorkspaceTab, projectName, setBoardOpen]);

  const handleStartBuilding = useCallback(() => {
    const board = readBoard(boardStorage);
    if (!hasBoardContent(board)) {
      setBoardOpen(true);
      setShowBuildGuardModal(true);
      return;
    }
    sendBoardToSpec({ openSpec: false });
    onStartBuilding?.();
    openWorkspaceTab('spec');
  }, [boardStorage, onStartBuilding, openWorkspaceTab, sendBoardToSpec, setBoardOpen]);

  const toggleParticipant = (id) => {
    setParticipantOverrides((prev) => {
      const current = prev[participantStorage] || activeParticipants;
      if (current.includes(id)) {
        const next = current.filter((value) => value !== id);
        const final = next.length > 0 ? next : current;
        try {
          localStorage.setItem(participantStorage, JSON.stringify(final));
        } catch {
          // ignore storage failures
        }
        return { ...prev, [participantStorage]: final };
      }
      const final = [...current, id];
      try {
        localStorage.setItem(participantStorage, JSON.stringify(final));
      } catch {
        // ignore storage failures
      }
      return { ...prev, [participantStorage]: final };
    });
  };

  const selectedLabels = DEFAULT_PARTICIPANTS
    .filter((item) => activeParticipants.includes(item.id))
    .map((item) => item.label);

  const runBrainstorm = useCallback(() => {
    const roster = selectedLabels.join(', ');
    const structuredPrompt = [
      'Office Meeting brainstorm request.',
      `Participants in room: ${roster}.`,
      'Return output in this EXACT markdown format and keep each section concise:',
      '',
      '# Goals',
      '- ...',
      '',
      '# Open Questions',
      '- ...',
      '',
      '# Decisions',
      '- ...',
      '',
      '# Next Actions',
      '- ...',
      '',
      '# Risks',
      '- ...',
      '',
      'Focus on practical scope for the next implementation milestone.',
    ].join('\n');
    const baseline = latestAgentMessage(latestMessagesRef.current);
    brainstormBaselineMessageIdRef.current = baseline?.id || null;
    setBrainstormParseWarning('');
    setBrainstormPending(true);
    onRunBrainstorm?.(structuredPrompt);
  }, [onRunBrainstorm, selectedLabels]);

  const handleVisibleMessagesChange = useCallback((nextMessages) => {
    latestMessagesRef.current = Array.isArray(nextMessages) ? nextMessages : [];
    if (!brainstormPending) return;

    const latest = latestAgentMessage(latestMessagesRef.current);
    if (!latest?.id) return;
    if (latest.id === brainstormBaselineMessageIdRef.current) return;
    if (latest.id === brainstormHandledMessageIdRef.current) return;

    brainstormHandledMessageIdRef.current = latest.id;
    setBrainstormPending(false);

    const parsed = parseStructuredBrainstorm(latest.content);
    if (!parsed.ok) {
      setBrainstormParseWarning(
        'Brainstorm output was not in the expected structure. Click "Re-run with structure".'
      );
      setBoardOpen(true);
      return;
    }

    const current = readBoard(boardStorage);
    const merged = {
      ...current,
      ...parsed.sections,
    };
    setBoardDraft(merged, { keepOpen: true });
    setBrainstormParseWarning('');
    setMeetingNotice('Structured brainstorm captured in Meeting Output.');
  }, [boardStorage, brainstormPending, setBoardDraft]);

  return (
    <div className="workspace-discuss-mode">
      <div className="discuss-meeting-header">
        <h3>Office Meeting: align on goal, risks, and decisions before building.</h3>
        <p>Brainstorm writes ideas. Office Board stores the final plan.</p>
      </div>

      <div className="discuss-meeting-steps" aria-label="Meeting steps">
        <span className="discuss-step-pill">1. Brainstorm</span>
        <span className="discuss-step-pill">2. Capture</span>
        <span className="discuss-step-pill">3. Handoff</span>
        <span className="discuss-step-pill">4. Build</span>
      </div>

      <header className="discuss-toolbar">
        <div className="discuss-toolbar-left">
          <button
            type="button"
            className="ui-btn"
            onClick={() => setParticipantsCollapsed(!participantsCollapsed)}
            data-tooltip="Select which roles participate in brainstorm prompts."
          >
            {participantsCollapsed ? `Participants (${selectedLabels.length})` : 'Hide Participants'}
          </button>
          <button
            type="button"
            className={`ui-btn ${boardOpen ? 'ui-btn-primary' : ''}`}
            onClick={() => setBoardOpen(!boardOpen)}
            data-tooltip="Show or hide Meeting Output. Use it to store final goals, questions, decisions, and next actions."
          >
            Office Board
            {boardHasContent ? <span className="ui-chip discuss-board-badge">Saved</span> : null}
          </button>
        </div>
        <div className="discuss-toolbar-actions">
          <button
            type="button"
            className="refresh-btn ui-btn ui-btn-primary"
            onClick={runBrainstorm}
            data-tooltip="Generate structured ideas from the selected roles. Produces goals/questions/decisions/next actions."
          >
            {brainstormPending ? 'Running Brainstorm…' : 'Run Brainstorm'}
          </button>
          <button
            type="button"
            className="refresh-btn ui-btn"
            onClick={handleStartBuilding}
            data-tooltip="Handoff meeting output to Spec/Tasks, then switch to Build mode."
          >
            Start Building
          </button>
        </div>
      </header>

      <p className="discuss-brainstorm-hint">
        Brainstorm writes ideas. Office Board stores the final plan and handoff.
      </p>

      {meetingNotice ? (
        <div className="discuss-inline-notice">{meetingNotice}</div>
      ) : null}

      {!participantsCollapsed ? (
        <section className="discuss-participants-panel">
          <div
            className="discuss-participants-label"
            data-tooltip="Select which roles participate in brainstorm prompts."
          >
            <strong>Participants in room</strong>
            <span>{selectedLabels.length} active</span>
          </div>
          <div className="discuss-participants-list">
            {DEFAULT_PARTICIPANTS.map((participant) => {
              const active = activeParticipants.includes(participant.id);
              return (
                <button
                  type="button"
                  key={participant.id}
                  className={`participant-chip ${active ? 'active' : ''}`}
                  onClick={() => toggleParticipant(participant.id)}
                  data-tooltip="Include/exclude this role from brainstorm prompts."
                >
                  {participant.label}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="workspace-discuss-canvas">
        {boardOpen ? (
          <SplitPane
            direction="vertical"
            ratio={ratio}
            defaultRatio={0.62}
            minPrimary={420}
            minSecondary={320}
            onRatioChange={(next) => {
              setRatioOverrides((prev) => ({ ...prev, [ratioStorage]: next }));
              try {
                localStorage.setItem(ratioStorage, String(next));
              } catch {
                // ignore storage failures
              }
            }}
          >
            <section className="workspace-discuss-chat">
              <ChatRoom
                channel={channel}
                workspaceMode="discuss"
                beginnerMode={beginnerMode}
                onBeginnerBrainstorm={runBrainstorm}
                onRequestOpenTab={openWorkspaceTab}
                showStatusPanel={false}
                compact
                queuedMessage={brainstormMessage}
                prefillText={chatPrefill}
                onPrefillConsumed={onChatPrefillConsumed}
                onVisibleMessagesChange={handleVisibleMessagesChange}
              />
            </section>
            <section className="workspace-discuss-board">
              <OfficeBoard
                projectName={projectName}
                onRunBrainstorm={runBrainstorm}
                onSendToSpec={() => sendBoardToSpec({ openSpec: true })}
                onSendToTasks={sendBoardToTasks}
                parseWarning={brainstormParseWarning}
                onRerunStructured={runBrainstorm}
              />
            </section>
          </SplitPane>
        ) : (
          <section className="workspace-discuss-chat workspace-discuss-chat-full">
            <ChatRoom
              channel={channel}
              workspaceMode="discuss"
              beginnerMode={beginnerMode}
              onBeginnerBrainstorm={runBrainstorm}
              onRequestOpenTab={openWorkspaceTab}
              showStatusPanel={false}
              compact
              queuedMessage={brainstormMessage}
              prefillText={chatPrefill}
              onPrefillConsumed={onChatPrefillConsumed}
              onVisibleMessagesChange={handleVisibleMessagesChange}
            />
          </section>
        )}
      </div>

      {showBuildGuardModal ? (
        <div className="workspace-handoff-backdrop discuss-build-guard-backdrop">
          <div className="workspace-handoff-modal discuss-build-guard-modal">
            <h3>No meeting output captured yet</h3>
            <p>
              Discuss notes are empty. Capture meeting output first so Build starts with clear goals and decisions.
            </p>
            <div className="workspace-handoff-actions">
              <button
                type="button"
                className="msg-action-btn ui-btn"
                onClick={() => {
                  setShowBuildGuardModal(false);
                  setBoardOpen(true);
                }}
              >
                Capture first
              </button>
              <button
                type="button"
                className="refresh-btn ui-btn ui-btn-primary"
                onClick={() => {
                  setShowBuildGuardModal(false);
                  onStartBuilding?.();
                  openWorkspaceTab('spec');
                }}
              >
                Build anyway
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
