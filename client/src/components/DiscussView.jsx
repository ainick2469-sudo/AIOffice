import { useMemo, useState } from 'react';
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
  const ratioStorage = useMemo(() => storageRatioKey(projectName), [projectName]);
  const persistedParticipants = useMemo(() => readParticipants(participantStorage), [participantStorage]);
  const persistedRatio = useMemo(() => readRatio(ratioStorage), [ratioStorage]);

  const [participantOverrides, setParticipantOverrides] = useState({});
  const [ratioOverrides, setRatioOverrides] = useState({});

  const activeParticipants = participantOverrides[participantStorage] || persistedParticipants;
  const ratio = ratioOverrides[ratioStorage] ?? persistedRatio;

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
      <header className="discuss-participants-strip">
        <div className="discuss-participants-label">
          <strong>Participants</strong>
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
              >
                {participant.label}
              </button>
            );
          })}
        </div>
        <div className="discuss-participants-actions">
          <button type="button" className="refresh-btn ui-btn ui-btn-primary" onClick={runBrainstorm}>
            Run brainstorm
          </button>
          <button type="button" className="refresh-btn ui-btn" onClick={onStartBuilding}>
            Start Building
          </button>
        </div>
      </header>

      <div className="workspace-discuss-canvas">
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
      </div>
    </div>
  );
}
