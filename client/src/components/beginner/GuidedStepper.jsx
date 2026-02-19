import { useEffect, useMemo, useState } from 'react';
import { fetchMessages } from '../../api';
import { computeCompleteness, parseSpecMarkdown } from '../spec/specSchema';
import { useBeginnerMode } from './BeginnerModeContext';

const DISCUSS_DONE_TARGET = 4;
const SPEC_READY_LENGTH = 420;
const SPEC_READY_COMPLETENESS = 70;

function statusClass(status) {
  const value = String(status || '').toLowerCase().replace(/\s+/g, '-');
  return `status-${value}`;
}

function discussStatus(messageCount) {
  if (messageCount <= 0) return 'Not started';
  if (messageCount < DISCUSS_DONE_TARGET) return 'In progress';
  return 'Done';
}

function specStatus(specMetrics) {
  if (specMetrics?.approved) return 'Done';
  if ((specMetrics?.length || 0) <= 0) return 'Not started';
  if ((specMetrics?.completeness || 0) >= SPEC_READY_COMPLETENESS && (specMetrics?.length || 0) >= SPEC_READY_LENGTH) {
    return 'Ready';
  }
  return 'In progress';
}

function buildStatus(progress, previewIsDone) {
  const openedFiles = Boolean(progress?.viewsOpened?.files);
  const openedTasks = Boolean(progress?.viewsOpened?.tasks);
  const openedCount = [openedFiles, openedTasks].filter(Boolean).length;
  if (openedCount === 0) return 'Not started';
  if (previewIsDone && openedCount >= 2) return 'Done';
  if (openedCount >= 2) return 'Ready';
  return 'In progress';
}

function previewStatus(progress) {
  if (progress?.preview?.running || progress?.preview?.url) return 'Done';
  if (progress?.viewsOpened?.preview) return 'In progress';
  return 'Not started';
}

export default function GuidedStepper({
  projectName = 'ai-office',
  channel = 'main',
  mode = 'discuss',
  onOpenDiscuss,
  onOpenSpec,
  onOpenBuild,
  onOpenPreview,
}) {
  const { getProjectProgress, setDiscussMessageCount, setSpecMetrics } = useBeginnerMode();
  const [loading, setLoading] = useState(false);

  const projectProgress = getProjectProgress(projectName);

  useEffect(() => {
    let cancelled = false;
    const readHeuristics = async () => {
      setLoading(true);
      try {
        const [messages, specResponse] = await Promise.all([
          fetchMessages(channel, 160).catch(() => []),
          fetch(`/api/spec/current?channel=${encodeURIComponent(channel)}`)
            .then((resp) => (resp.ok ? resp.json() : null))
            .catch(() => null),
        ]);

        if (cancelled) return;

        const messageCount = Array.isArray(messages) ? messages.length : 0;
        setDiscussMessageCount(projectName, messageCount);

        const specMd = String(specResponse?.spec_md || '');
        const parsed = parseSpecMarkdown(specMd);
        const completeness = computeCompleteness(parsed);
        setSpecMetrics(projectName, {
          length: specMd.trim().length,
          completeness: completeness.percent,
          approved: String(specResponse?.status || '').toLowerCase() === 'approved',
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    readHeuristics();
    const interval = window.setInterval(readHeuristics, 7000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [channel, projectName, setDiscussMessageCount, setSpecMetrics]);

  const discuss = discussStatus(projectProgress.discussMessageCount);
  const spec = specStatus(projectProgress.spec);
  const preview = previewStatus(projectProgress);
  const build = buildStatus(projectProgress, preview === 'Done');

  const steps = useMemo(
    () => ([
      {
        id: 'discuss',
        title: 'Step 1: Discuss',
        status: discuss,
        description: 'Clarify goals and constraints with the team.',
        actionLabel: mode === 'discuss' ? 'Continue' : 'Open Discuss',
        onAction: onOpenDiscuss,
      },
      {
        id: 'spec',
        title: 'Step 2: Spec',
        status: spec,
        description: 'Turn ideas into a clear, testable plan.',
        actionLabel: 'Open Spec',
        onAction: onOpenSpec,
      },
      {
        id: 'build',
        title: 'Step 3: Build',
        status: build,
        description: 'Implement in files/tasks with guided checkpoints.',
        actionLabel: 'Open Build',
        onAction: onOpenBuild,
      },
      {
        id: 'preview',
        title: 'Step 4: Preview',
        status: preview,
        description: 'Run and validate the app with visible output.',
        actionLabel: 'Open Preview',
        onAction: onOpenPreview,
      },
    ]),
    [build, discuss, mode, onOpenBuild, onOpenDiscuss, onOpenPreview, onOpenSpec, preview, spec]
  );

  return (
    <section className="beginner-stepper">
      <header className="beginner-stepper-header">
        <div>
          <h4>Beginner Guide</h4>
          <p>Follow this path from idea to running preview.</p>
        </div>
        {loading ? <span className="beginner-stepper-loading">Updating…</span> : null}
      </header>

      <div className="beginner-stepper-grid">
        {steps.map((step) => (
          <article key={step.id} className="beginner-step-card">
            <div className="beginner-step-card-top">
              <strong>{step.title}</strong>
              <span className={`beginner-step-status ${statusClass(step.status)}`}>{step.status}</span>
            </div>
            <p>{step.description}</p>
            <button type="button" className="ui-btn ui-btn-primary" onClick={step.onAction}>
              {step.actionLabel}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

