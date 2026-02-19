import { useEffect, useMemo, useState } from 'react';

function boardKey(projectName) {
  const safe = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  return `ai-office:office-board:${safe}`;
}

function emptyBoard() {
  return {
    goals: '',
    questions: '',
    decisions: '',
    next_steps: '',
  };
}

function loadBoard(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return emptyBoard();
    const parsed = JSON.parse(raw);
    return {
      goals: String(parsed?.goals || ''),
      questions: String(parsed?.questions || ''),
      decisions: String(parsed?.decisions || ''),
      next_steps: String(parsed?.next_steps || ''),
    };
  } catch {
    return emptyBoard();
  }
}

function hasBoardContent(board) {
  return ['goals', 'questions', 'decisions', 'next_steps'].some(
    (field) => String(board?.[field] || '').trim().length > 0
  );
}

export default function OfficeBoard({ projectName = 'ai-office' }) {
  const key = useMemo(() => boardKey(projectName), [projectName]);
  const persistedBoard = useMemo(() => loadBoard(key), [key]);
  const [boardDrafts, setBoardDrafts] = useState({});
  const [savedAt, setSavedAt] = useState(null);
  const board = boardDrafts[key] || persistedBoard;

  useEffect(() => {
    const handle = window.setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(board));
        setSavedAt(new Date());
        window.dispatchEvent(
          new CustomEvent('office-board:updated', {
            detail: {
              projectName,
              hasContent: hasBoardContent(board),
            },
          })
        );
      } catch {
        // ignore local storage errors
      }
    }, 220);
    return () => window.clearTimeout(handle);
  }, [board, key, projectName]);

  const updateField = (field, value) => {
    setBoardDrafts((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || board),
        [field]: value,
      },
    }));
  };

  const clearBoard = () => {
    const cleared = emptyBoard();
    setBoardDrafts((prev) => ({ ...prev, [key]: cleared }));
    try {
      localStorage.removeItem(key);
      window.dispatchEvent(
        new CustomEvent('office-board:updated', {
          detail: {
            projectName,
            hasContent: false,
          },
        })
      );
    } catch {
      // ignore storage failures
    }
  };

  return (
    <section className="office-board">
      <header className="office-board-header">
        <h3 data-tooltip="Office Board keeps the agreed goals, open questions, and decisions visible while you build.">
          Office Board
        </h3>
        <button
          type="button"
          className="msg-action-btn ui-btn"
          onClick={clearBoard}
          data-tooltip="Clear this board for the current project."
        >
          Clear
        </button>
      </header>
      <p className="office-board-subtitle">
        Capture project intent before entering build mode.
      </p>
      <p className="office-board-hint">
        Office Board = sticky notes for Goals / Questions / Decisions. Use it to keep the team aligned.
      </p>

      <div className="office-board-grid">
        <label className="office-board-field">
          <span data-tooltip="Goals: What outcome are we delivering?">Goals</span>
          <textarea
            className="ui-input"
            value={board.goals}
            onChange={(event) => updateField('goals', event.target.value)}
            rows={4}
            placeholder="What outcome are we trying to deliver?"
          />
        </label>

        <label className="office-board-field">
          <span data-tooltip="Open Questions: What is still unclear and needs a decision?">Open Questions</span>
          <textarea
            className="ui-input"
            value={board.questions}
            onChange={(event) => updateField('questions', event.target.value)}
            rows={4}
            placeholder="What do we still need to clarify?"
          />
        </label>

        <label className="office-board-field">
          <span data-tooltip="Decisions: What has been agreed and should not change silently?">Decisions</span>
          <textarea
            className="ui-input"
            value={board.decisions}
            onChange={(event) => updateField('decisions', event.target.value)}
            rows={4}
            placeholder="What has been agreed?"
          />
        </label>

        <label className="office-board-field">
          <span>Next Steps</span>
          <textarea
            className="ui-input"
            value={board.next_steps}
            onChange={(event) => updateField('next_steps', event.target.value)}
            rows={4}
            placeholder="What should happen next?"
          />
        </label>
      </div>

      <div className="office-board-footer">
        {savedAt ? `Saved ${savedAt.toLocaleTimeString()}` : 'Draft board'}
      </div>
    </section>
  );
}
