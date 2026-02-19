import { useEffect, useMemo, useRef, useState } from 'react';

function boardKey(projectName) {
  const safe = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  return `ai-office:office-board:${safe.replace(/[^a-z0-9-]+/g, '-')}`;
}

function risksToggleKey(projectName) {
  const safe = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  return `ai-office:office-board-risks-open:${safe.replace(/[^a-z0-9-]+/g, '-')}`;
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

function loadBoard(key) {
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

function readRisksOpen(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw === 'true';
  } catch {
    return false;
  }
}

export default function OfficeBoard({
  projectName = 'ai-office',
  onRunBrainstorm = null,
  onSendToSpec = null,
  onSendToTasks = null,
  parseWarning = '',
  onRerunStructured = null,
}) {
  const key = useMemo(() => boardKey(projectName), [projectName]);
  const risksKey = useMemo(() => risksToggleKey(projectName), [projectName]);
  const persistedBoard = useMemo(() => loadBoard(key), [key]);
  const persistedRisksOpen = useMemo(() => readRisksOpen(risksKey), [risksKey]);
  const [boardDrafts, setBoardDrafts] = useState({});
  const [savedAt, setSavedAt] = useState(null);
  const [risksOpenOverrides, setRisksOpenOverrides] = useState({});
  const firstFieldRef = useRef(null);
  const board = boardDrafts[key] || persistedBoard;
  const risksOpen = risksOpenOverrides[risksKey] ?? persistedRisksOpen;

  const setRisksOpen = (nextValue) => {
    const normalized = Boolean(nextValue);
    setRisksOpenOverrides((prev) => ({ ...prev, [risksKey]: normalized }));
    try {
      localStorage.setItem(risksKey, normalized ? 'true' : 'false');
    } catch {
      // ignore storage failures
    }
  };

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

  useEffect(() => {
    const onReplace = (event) => {
      const detailProject = String(event?.detail?.projectName || '').trim().toLowerCase();
      const currentProject = String(projectName || 'ai-office').trim().toLowerCase();
      if (detailProject && detailProject !== currentProject) return;
      const nextBoard = normalizeBoard(event?.detail?.board);
      setBoardDrafts((prev) => ({ ...prev, [key]: nextBoard }));
    };
    window.addEventListener('office-board:replace', onReplace);
    return () => window.removeEventListener('office-board:replace', onReplace);
  }, [key, projectName]);

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
    setRisksOpen(false);
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

  const boardIsEmpty = !hasBoardContent(board);

  return (
    <section className="office-board">
      <header className="office-board-header">
        <h3 data-tooltip="Meeting Output captures finalized goals, open questions, decisions, next actions, and risks for clean handoff to build.">
          Meeting Output (Office Board)
        </h3>
        <div className="office-board-actions">
          <button
            type="button"
            className="msg-action-btn ui-btn"
            onClick={() => onSendToSpec?.()}
            data-tooltip="Compose a spec draft from this meeting output and open Spec."
          >
            Send to Spec
          </button>
          <button
            type="button"
            className="msg-action-btn ui-btn"
            onClick={() => onSendToTasks?.()}
            data-tooltip="Convert next actions and open questions into a tasks draft and open Tasks."
          >
            Send to Tasks
          </button>
          <button
            type="button"
            className="msg-action-btn ui-btn"
            onClick={clearBoard}
            data-tooltip="Clear this meeting output for the current project."
          >
            Clear
          </button>
        </div>
      </header>
      <p className="office-board-subtitle">
        Capture the final goals, open questions, decisions, and next actions.
      </p>
      <p className="office-board-hint">
        Office Board = sticky notes for the final plan before handoff.
      </p>

      {parseWarning ? (
        <div className="office-board-warning">
          <span>{parseWarning}</span>
          <button
            type="button"
            className="ui-btn"
            onClick={() => onRerunStructured?.()}
            data-tooltip="Retry brainstorm with strict structured headings."
          >
            Re-run with structure
          </button>
        </div>
      ) : null}

      {boardIsEmpty ? (
        <div className="office-board-empty">
          <strong>Nothing captured yet.</strong>
          <span>Run Brainstorm or type directly here.</span>
          <div className="office-board-empty-actions">
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              onClick={() => onRunBrainstorm?.()}
              data-tooltip="Generate a structured meeting brainstorm and populate this board."
            >
              Run Brainstorm
            </button>
            <button
              type="button"
              className="ui-btn"
              onClick={() => firstFieldRef.current?.focus()}
              data-tooltip="Start capturing a goal manually."
            >
              Start with a Goal
            </button>
          </div>
        </div>
      ) : null}

      <div className="office-board-grid">
        <label className="office-board-field">
          <span data-tooltip="Goals: What outcome are we delivering?">Goals</span>
          <textarea
            ref={firstFieldRef}
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
          <span data-tooltip="Next Actions: What should happen immediately after this meeting?">Next Actions</span>
          <textarea
            className="ui-input"
            value={board.next_steps}
            onChange={(event) => updateField('next_steps', event.target.value)}
            rows={4}
            placeholder="What should happen next?"
          />
        </label>

        <section className="office-board-field office-board-risks">
          <button
            type="button"
            className="ui-btn office-board-section-toggle"
            onClick={() => setRisksOpen(!risksOpen)}
            data-tooltip="Optional section for delivery and technical risks."
          >
            {risksOpen ? 'Hide Risks' : 'Show Risks (optional)'}
          </button>
          {risksOpen ? (
            <>
              <span data-tooltip="Risks: What can block scope, quality, or schedule?">Risks</span>
              <textarea
                className="ui-input"
                value={board.risks}
                onChange={(event) => updateField('risks', event.target.value)}
                rows={4}
                placeholder="What could block or derail delivery?"
              />
            </>
          ) : null}
        </section>
      </div>

      <div className="office-board-footer">
        {savedAt ? `Saved ${savedAt.toLocaleTimeString()}` : 'Draft board'}
      </div>
    </section>
  );
}
