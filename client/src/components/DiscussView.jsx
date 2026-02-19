import { useEffect, useMemo, useState } from 'react';
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

function participantsKey(projectName) {
  const safe = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  return `ai-office:discuss-participants:${safe}`;
}

function participantsCollapsedKey(projectName) {
  const safe = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  return `ai-office:discuss-participants-collapsed:${safe}`;
}

function boardOpenKey(projectName) {
  const safe = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  return `ai-office:discuss-board-open:${safe}`;
}

function boardStorageKey(projectName) {
  const safe = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  return `ai-office:office-board:${safe}`;
}

function boardAutoOpenSessionKey(projectName) {
  const safe = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  return `ai-office:discuss-board-autopen:${safe}`;
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
  const safe = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  return `ai-office:discuss-layout-ratio:${safe}`;
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

function readBoardHasContent(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return ['goals', 'questions', 'decisions', 'next_steps'].some(
      (field) => String(parsed?.[field] || '').trim().length > 0
    );
  } catch {
    return false;
  }
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
  const [boardHasContent, setBoardHasContent] = useState(() => readBoardHasContent(boardStorage));

  const activeParticipants = participantOverrides[participantStorage] || persistedParticipants;
  const ratio = ratioOverrides[ratioStorage] ?? persistedRatio;
  const participantsCollapsed = participantCollapseOverrides[participantCollapsedStorage]
    ?? persistedParticipantsCollapsed;
  const boardOpen = boardOpenOverrides[boardOpenStorage] ?? persistedBoardOpen;

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
    setBoardHasContent(readBoardHasContent(boardStorage));
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

  const setParticipantsCollapsed = (nextValue) => {
    const normalized = Boolean(nextValue);
    setParticipantCollapseOverrides((prev) => ({ ...prev, [participantCollapsedStorage]: normalized }));
    try {
      localStorage.setItem(participantCollapsedStorage, normalized ? 'true' : 'false');
    } catch {
      // ignore storage failures
    }
  };

  const setBoardOpen = (nextValue) => {
    const normalized = Boolean(nextValue);
    setBoardOpenOverrides((prev) => ({ ...prev, [boardOpenStorage]: normalized }));
    try {
      localStorage.setItem(boardOpenStorage, normalized ? 'true' : 'false');
    } catch {
      // ignore storage failures
    }
  };

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

  const runBrainstorm = () => {
    const roster = selectedLabels.join(', ');
    const formatted = [
      'Office brainstorm session request:',
      `Participants in room: ${roster}.`,
      'Please discuss this project idea collaboratively, challenge assumptions, propose 2-3 solution directions, and end with a recommended approach plus open questions.',
    ].join('\n');
    onRunBrainstorm?.(formatted);
  };

  return (
    <div className="workspace-discuss-mode">
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
            data-tooltip="Show or hide Office Board. Use it to store final goals, questions, and decisions."
          >
            {boardOpen ? 'Hide Office Board' : 'Office Board'}
          </button>
        </div>
        <div className="discuss-toolbar-actions">
          <button
            type="button"
            className="refresh-btn ui-btn ui-btn-primary"
            onClick={runBrainstorm}
            data-tooltip="Sends a structured team brainstorm prompt into chat. Produces directions + open questions."
          >
            Run brainstorm
          </button>
          <button
            type="button"
            className="refresh-btn ui-btn"
            onClick={onStartBuilding}
            data-tooltip="Switch to Build mode. Opens Spec first so implementation stays grounded."
          >
            Start Building
          </button>
        </div>
      </header>

      <p className="discuss-brainstorm-hint">
        Brainstorm writes suggestions into chat. Office Board stores final goals/questions/decisions.
      </p>

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
                onRequestOpenTab={onOpenTab}
                showStatusPanel={false}
                compact
                queuedMessage={brainstormMessage}
                prefillText={chatPrefill}
                onPrefillConsumed={onChatPrefillConsumed}
              />
            </section>
            <section className="workspace-discuss-board">
              <OfficeBoard projectName={projectName} />
            </section>
          </SplitPane>
        ) : (
          <section className="workspace-discuss-chat workspace-discuss-chat-full">
            <ChatRoom
              channel={channel}
              workspaceMode="discuss"
              beginnerMode={beginnerMode}
              onBeginnerBrainstorm={runBrainstorm}
              onRequestOpenTab={onOpenTab}
              showStatusPanel={false}
              compact
              queuedMessage={brainstormMessage}
              prefillText={chatPrefill}
              onPrefillConsumed={onChatPrefillConsumed}
            />
          </section>
        )}
      </div>
    </div>
  );
}
