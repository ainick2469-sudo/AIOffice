import { useEffect, useMemo, useState } from 'react';
import ChatRoom from '../ChatRoom';
import SplitPane from '../layout/SplitPane';
import DraftSummaryPanel from './DraftSummaryPanel';

const PARTICIPANTS = [
  { id: 'builder', label: 'Builder' },
  { id: 'designer', label: 'Designer' },
  { id: 'qa', label: 'QA' },
];

function summarizePrompt(prompt) {
  const raw = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (!raw) return 'Define the exact product outcome in one sentence.';
  if (raw.length <= 120) return raw;
  return `${raw.slice(0, 117).trim()}...`;
}

function buildClarifyingBullets(draft) {
  const prompt = String(draft?.text || '').trim();
  const summary = draft?.summary || {};
  const stack = String(draft?.suggestedStack || '').trim();
  const importCount = Array.isArray(draft?.importQueue) ? draft.importQueue.length : 0;
  const bullets = [];

  bullets.push(`Outcome target: ${summarizePrompt(prompt)}`);
  bullets.push(stack && stack !== 'auto-detect'
    ? `Preferred stack is ${stack}; confirm this is still the right default before building.`
    : 'Confirm preferred stack or keep auto-detect for first implementation pass.');
  bullets.push(importCount > 0
    ? `Imported assets detected (${importCount}); align what should be reused vs rebuilt.`
    : 'Define first milestone scope so the initial build stays small and testable.');
  bullets.push(summary?.questions
    ? `Open question to resolve: ${String(summary.questions).trim()}`
    : 'Capture 1-3 unresolved questions to prevent rework during implementation.');
  bullets.push(summary?.risks
    ? `Primary risk: ${String(summary.risks).trim()}`
    : 'Identify the highest execution risk and how it will be validated in preview.');

  return bullets.slice(0, 5);
}

function participantsStorageKey(projectName) {
  const safe = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  return `ai-office:draft-discuss-participants:${safe}`;
}

function ratioStorageKey(projectName) {
  const safe = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  return `ai-office:draft-discuss-ratio:${safe}`;
}

function readParticipants(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return PARTICIPANTS.map((item) => item.id);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return PARTICIPANTS.map((item) => item.id);
    const allowed = new Set(PARTICIPANTS.map((item) => item.id));
    const filtered = parsed.filter((value) => allowed.has(value));
    return filtered.length ? filtered : PARTICIPANTS.map((item) => item.id);
  } catch {
    return PARTICIPANTS.map((item) => item.id);
  }
}

function readRatio(key) {
  try {
    const raw = Number(localStorage.getItem(key));
    if (Number.isFinite(raw) && raw > 0.2 && raw < 0.8) return raw;
  } catch {
    // ignore storage failures
  }
  return 0.62;
}

export default function DraftDiscussView({
  channel = 'main',
  projectName = 'ai-office',
  beginnerMode = false,
  draft,
  onDraftChange,
  onCreateProject,
  onPrimaryAction = null,
  primaryActionLabel = 'Create Project & Start Building',
  onDiscardDraft,
  onEditDraft,
}) {
  const participantKey = useMemo(() => participantsStorageKey(projectName), [projectName]);
  const ratioKey = useMemo(() => ratioStorageKey(projectName), [projectName]);
  const [participants, setParticipants] = useState(() => readParticipants(participantKey));
  const [ratio, setRatio] = useState(() => readRatio(ratioKey));
  const [queuedMessage, setQueuedMessage] = useState(null);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState(String(draft?.text || ''));
  const [creating, setCreating] = useState(false);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [error, setError] = useState('');
  const clarifyingBullets = useMemo(() => buildClarifyingBullets(draft), [draft]);

  useEffect(() => {
    setParticipants(readParticipants(participantKey));
  }, [participantKey]);

  useEffect(() => {
    setRatio(readRatio(ratioKey));
  }, [ratioKey]);

  useEffect(() => {
    setPromptDraft(String(draft?.text || ''));
  }, [draft?.id, draft?.text]);

  const seedMessageText = useMemo(() => {
    const prompt = String(draft?.text || '');
    if (!prompt || draft?.discussionSeeded) return '';
    return [
      'We are planning a new project.',
      `User request: ${prompt}`,
      'Brainstorm ideas, key mechanics, and scope. Ask clarifying questions if needed.',
    ].join(' ');
  }, [draft?.text, draft?.discussionSeeded]);

  useEffect(() => {
    if (!seedMessageText) return;
    const id = `draft-seed-${draft?.createdAt || Date.now()}`;
    setQueuedMessage({ id, text: seedMessageText });
    onDraftChange?.({
      discussionSeeded: true,
    });
  }, [seedMessageText, draft?.createdAt, onDraftChange]);

  const toggleParticipant = (id) => {
    setParticipants((prev) => {
      const next = prev.includes(id)
        ? prev.filter((value) => value !== id)
        : [...prev, id];
      const final = next.length > 0 ? next : prev;
      try {
        localStorage.setItem(participantKey, JSON.stringify(final));
      } catch {
        // ignore storage failures
      }
      return final;
    });
  };

  const runBrainstorm = () => {
    const roster = PARTICIPANTS
      .filter((item) => participants.includes(item.id))
      .map((item) => item.label)
      .join(', ');
    const text = [
      'Draft planning session:',
      `Participants: ${roster || 'Builder, Designer, QA'}.`,
      `Prompt: ${String(draft?.text || '').trim()}`,
      'Provide options, tradeoffs, scope recommendation, and 3 clarifying questions.',
    ].join('\n');
    setQueuedMessage({ id: `brainstorm-${Date.now()}`, text });
    const existing = Array.isArray(draft?.brainstormMessages) ? draft.brainstormMessages : [];
    onDraftChange?.({
      brainstormMessages: [
        ...existing,
        {
          id: `brainstorm-${Date.now()}`,
          role: 'system',
          content: text,
          createdAt: new Date().toISOString(),
          source: 'more_ideas',
        },
      ],
    });
  };

  const generateIdeas = async () => {
    if (ideasLoading) return;
    setIdeasLoading(true);
    setError('');
    const payload = {
      seed_prompt: String(draft?.seedPrompt || draft?.rawRequest || draft?.text || ''),
      template_id: draft?.templateId || null,
      project_name: draft?.projectName || draft?.suggestedName || null,
      stack_hint: draft?.stackHint || draft?.suggestedStack || null,
    };
    try {
      const resp = await fetch('/api/creation/brainstorm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = resp.ok ? await resp.json() : null;
      if (!resp.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to generate ideas.');
      }
      const summarised = {
        goals: String(data?.scope || draft?.summary?.goals || ''),
        risks: Array.isArray(data?.risks) ? data.risks.join(' ') : String(draft?.summary?.risks || ''),
        questions: Array.isArray(data?.clarifying_questions) ? data.clarifying_questions.join(' ') : String(draft?.summary?.questions || ''),
        nextSteps: Array.isArray(data?.next_steps) ? data.next_steps.join(' ') : String(draft?.summary?.nextSteps || ''),
      };
      const messageText = [
        'Brainstorm summary',
        `Scope: ${data?.scope || 'TBD'}`,
        `Assumptions: ${(data?.assumptions || []).join(' | ') || 'None'}`,
        `Risks: ${(data?.risks || []).join(' | ') || 'None'}`,
        `Questions: ${(data?.clarifying_questions || []).join(' | ') || 'None'}`,
      ].join('\n');
      setQueuedMessage({ id: `ideas-${Date.now()}`, text: messageText });
      const existing = Array.isArray(draft?.brainstormMessages) ? draft.brainstormMessages : [];
      onDraftChange?.({
        summary: summarised,
        suggestedStack: data?.suggested_stack || draft?.suggestedStack,
        stackHint: data?.suggested_stack || draft?.stackHint,
        brainstormMessages: [
          ...existing,
          {
            id: `ideas-${Date.now()}`,
            role: 'assistant',
            content: messageText,
            structured: data,
            createdAt: new Date().toISOString(),
            source: 'generate_ideas',
          },
        ],
      });
    } catch (err) {
      setError(err?.message || 'Unable to generate ideas.');
    } finally {
      setIdeasLoading(false);
    }
  };

  const savePromptEdit = () => {
    const nextText = String(promptDraft || '');
    onDraftChange?.({
      text: nextText,
      rawRequest: nextText,
      lastEditedAt: new Date().toISOString(),
    });
    setEditingPrompt(false);
  };

  const resetPromptEdit = () => {
    setPromptDraft(String(draft?.text || ''));
    setEditingPrompt(false);
  };

  const runPrimaryAction = async () => {
    if (creating) return;
    setCreating(true);
    setError('');
    try {
      if (typeof onPrimaryAction === 'function') {
        await onPrimaryAction(draft);
      } else {
        await onCreateProject?.(draft);
      }
    } catch (err) {
      setError(err?.message || 'Primary action failed.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="draft-discuss-view">
      <header className="draft-discuss-head panel">
        <div className="draft-prompt-card">
          <div className="draft-prompt-card-top">
            <h3>Draft Prompt</h3>
            <div className="draft-prompt-actions">
              {!editingPrompt ? (
                <button type="button" className="ui-btn" onClick={() => setEditingPrompt(true)}>
                  Edit Prompt
                </button>
              ) : (
                <>
                  <button type="button" className="ui-btn" onClick={resetPromptEdit}>
                    Cancel
                  </button>
                  <button type="button" className="ui-btn ui-btn-primary" onClick={savePromptEdit}>
                    Save Prompt
                  </button>
                </>
              )}
            </div>
          </div>
          {!editingPrompt ? (
            <pre className="draft-prompt-readonly">{String(draft?.text || '')}</pre>
          ) : (
            <textarea
              className="ui-input draft-prompt-editor"
              value={promptDraft}
              onChange={(event) => setPromptDraft(event.target.value)}
              rows={7}
            />
          )}
        </div>

        <div className="draft-head-cta">
          <section className="draft-intake-summary">
            <h4>Discuss Intake Summary</h4>
            <ul>
              {clarifyingBullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        <button type="button" className="ui-btn ui-btn-primary" onClick={runPrimaryAction} disabled={creating}>
          {creating ? 'Working...' : primaryActionLabel}
        </button>
          <button type="button" className="ui-btn ui-btn-primary" onClick={generateIdeas} disabled={ideasLoading}>
            {ideasLoading ? 'Generating…' : 'Generate ideas'}
          </button>
          <button type="button" className="ui-btn" onClick={runBrainstorm}>
            More Ideas
          </button>
          <button type="button" className="ui-btn ui-btn-ghost" onClick={() => onEditDraft?.({ text: String(draft?.text || '') })}>
            Edit Prompt in Home
          </button>
          <button type="button" className="ui-btn ui-btn-destructive" onClick={onDiscardDraft}>
            Discard Draft
          </button>
          {error && <div className="agent-config-error">{error}</div>}
        </div>
      </header>

      <div className="draft-participants-strip panel">
        <div className="draft-participants-list">
          {PARTICIPANTS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`participant-chip ${participants.includes(item.id) ? 'active' : ''}`}
              onClick={() => toggleParticipant(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button type="button" className="ui-btn ui-btn-primary" onClick={runBrainstorm}>
          Run brainstorm
        </button>
      </div>

      <div className="draft-discuss-canvas">
        <SplitPane
          direction="vertical"
          ratio={ratio}
          defaultRatio={0.62}
          minPrimary={420}
          minSecondary={320}
          onRatioChange={(nextRatio) => {
            setRatio(nextRatio);
            try {
              localStorage.setItem(ratioKey, String(nextRatio));
            } catch {
              // ignore storage failures
            }
          }}
        >
          <section className="draft-discuss-chat">
            <ChatRoom
              channel={channel}
              workspaceMode="discuss-draft"
              beginnerMode={beginnerMode}
              onBeginnerBrainstorm={runBrainstorm}
              showStatusPanel={false}
              compact
              queuedMessage={queuedMessage}
            />
          </section>
          <section className="draft-discuss-summary">
            <DraftSummaryPanel
              summary={draft?.summary || {}}
              onChangeSummary={(summary) => onDraftChange?.({ summary })}
              suggestedName={draft?.suggestedName}
              suggestedStack={draft?.suggestedStack}
              importQueue={draft?.importQueue || []}
            />
          </section>
        </SplitPane>
      </div>
    </div>
  );
}
