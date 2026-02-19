import { useCallback, useEffect, useMemo, useState } from 'react';
import SplitPane from '../layout/SplitPane';
import ChangesList from './ChangesList';
import DiffViewer from './DiffViewer';
import CommitPanel from './CommitPanel';
import BranchPanel from './BranchPanel';
import CheckpointPanel from './CheckpointPanel';
import '../../styles/git.css';
import useBodyScrollLock from '../../hooks/useBodyScrollLock';
import useEscapeKey from '../../hooks/useEscapeKey';

function materializePath(template, project) {
  const encoded = encodeURIComponent(String(project || 'ai-office'));
  return String(template || '')
    .replace('{name}', encoded)
    .replace('{project}', encoded)
    .replace('{project_name}', encoded);
}

function summarizeLog(logText) {
  const lines = String(logText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const first = lines[0];
  const match = first.match(/^([0-9a-f]{7,40})\s+(.*)$/i);
  if (match) {
    return { hash: match[1], message: match[2], when: '' };
  }
  return { hash: '', message: first, when: '' };
}

function inferCommitSuggestion(changes) {
  const paths = changes.map((item) => String(item.path || '').toLowerCase());
  if (!paths.length) return '';
  const docsOnly = paths.every((path) => path.endsWith('.md') || path.includes('/docs/') || path.includes('readme'));
  if (docsOnly) return 'docs: update documentation';
  if (paths.some((path) => path.includes('test') || path.endsWith('.spec.ts') || path.endsWith('.test.js'))) {
    return 'test: update coverage for recent changes';
  }
  if (paths.some((path) => path.includes('refactor') || path.includes('cleanup'))) {
    return 'refactor: simplify internal implementation';
  }
  if (paths.some((path) => path.includes('fix') || path.includes('bug'))) {
    return 'fix: resolve behavior regression';
  }
  return 'feat: implement scoped updates';
}

function parseDiffMap(diffText) {
  const source = String(diffText || '');
  if (!source.trim()) return {};
  const blocks = {};
  let currentPath = '';
  let currentLines = [];

  source.split('\n').forEach((line) => {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match) {
      if (currentPath) {
        blocks[currentPath] = currentLines.join('\n');
      }
      currentPath = match[2] === '/dev/null' ? match[1] : match[2];
      currentLines = [line];
      return;
    }
    if (currentPath) currentLines.push(line);
  });

  if (currentPath) blocks[currentPath] = currentLines.join('\n');

  return Object.fromEntries(
    Object.entries(blocks).map(([path, text]) => {
      let added = 0;
      let removed = 0;
      text.split('\n').forEach((line) => {
        if (line.startsWith('+++') || line.startsWith('---')) return;
        if (line.startsWith('+')) added += 1;
        if (line.startsWith('-')) removed += 1;
      });
      const summary = added || removed ? `+${added} -${removed}` : '';
      return [path, { text, added, removed, summary }];
    })
  );
}

function parseStatus(statusText, diffMap) {
  const staged = [];
  const unstaged = [];
  const lines = String(statusText || '').split('\n');

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();
    const match = line.match(/^([ MADRCU?])([ MADRCU?])\s+(.+)$/);
    if (!match) return;

    const stagedCode = match[1];
    const unstagedCode = match[2];
    const rawPath = match[3].replace(/^"|"$/g, '');
    const path = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop().trim() : rawPath.trim();
    const statusCode = (unstagedCode !== ' ' ? unstagedCode : stagedCode) || '?';
    const diffData = diffMap[path] || { text: '', summary: '' };

    const item = {
      path,
      stagedCode,
      unstagedCode,
      statusCode,
      changeSummary: diffData.summary,
      diff: diffData.text || '',
    };

    if (!(stagedCode === '?' && unstagedCode === '?') && stagedCode !== ' ') {
      staged.push(item);
    }
    if (unstagedCode !== ' ') {
      unstaged.push(item);
    }
  });

  return { staged, unstaged };
}

function isRepoMissing(statusText, errorText) {
  const source = `${String(statusText || '')}\n${String(errorText || '')}`.toLowerCase();
  return source.includes('not a git repository') || source.includes('fatal: not a git repository');
}

export default function GitTab({ channel = 'main', beginnerMode = false, onOpenTab = null }) {
  const [project, setProject] = useState('ai-office');
  const [currentBranch, setCurrentBranch] = useState('main');
  const [branches, setBranches] = useState([]);
  const [statusText, setStatusText] = useState('');
  const [logText, setLogText] = useState('');
  const [diffText, setDiffText] = useState('');
  const [checkpoints, setCheckpoints] = useState([]);
  const [mergeSource, setMergeSource] = useState('');
  const [mergeTarget, setMergeTarget] = useState('main');
  const [mergeResult, setMergeResult] = useState(null);
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [diffMode, setDiffMode] = useState('unified');
  const [notice, setNotice] = useState('');
  const [errorDetails, setErrorDetails] = useState('');
  const [loading, setLoading] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [template, setTemplate] = useState('feat');
  const [leftRatio, setLeftRatio] = useState(0.26);
  const [centerRatio, setCenterRatio] = useState(0.66);
  const [compactPane, setCompactPane] = useState('diff');
  const [isNarrow, setIsNarrow] = useState(false);
  const [createBranchOpen, setCreateBranchOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [checkpointCreateOpen, setCheckpointCreateOpen] = useState(false);
  const [checkpointName, setCheckpointName] = useState('');
  const [checkpointNote, setCheckpointNote] = useState('');
  const [restoreModal, setRestoreModal] = useState({ open: false, checkpoint: null, confirm: '' });
  const [capabilities, setCapabilities] = useState({
    stage: false,
    unstage: false,
    stagePath: '',
    unstagePath: '',
  });

  const hasModalOpen = checkpointCreateOpen || restoreModal.open || createBranchOpen;
  useBodyScrollLock(Boolean(hasModalOpen), 'git-modal');

  const closeGitOverlays = useCallback(() => {
    if (restoreModal.open) {
      setRestoreModal({ open: false, checkpoint: null, confirm: '' });
      return true;
    }
    if (checkpointCreateOpen) {
      setCheckpointCreateOpen(false);
      return true;
    }
    if (createBranchOpen) {
      setCreateBranchOpen(false);
      return true;
    }
    return false;
  }, [checkpointCreateOpen, createBranchOpen, restoreModal.open]);

  useEscapeKey((event) => {
    const handled = closeGitOverlays();
    if (handled) {
      event.preventDefault();
    }
  }, true);

  useEffect(() => {
    const onGlobalEscape = (event) => {
      const handled = closeGitOverlays();
      if (handled && event?.detail) {
        event.detail.handled = true;
      }
    };
    const onResetUi = () => {
      setCheckpointCreateOpen(false);
      setCreateBranchOpen(false);
      setRestoreModal({ open: false, checkpoint: null, confirm: '' });
    };
    window.addEventListener('ai-office:escape', onGlobalEscape);
    window.addEventListener('ai-office:reset-ui-state', onResetUi);
    return () => {
      window.removeEventListener('ai-office:escape', onGlobalEscape);
      window.removeEventListener('ai-office:reset-ui-state', onResetUi);
    };
  }, [closeGitOverlays]);

  const run = useCallback(async (url, options = {}) => {
    const response = await fetch(url, options);
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    if (!response.ok || payload?.detail) {
      throw new Error(payload?.detail || payload?.error || payload?.stderr || `Request failed (${response.status}).`);
    }
    return payload;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErrorDetails('');
    try {
      const activeResponse = await fetch(`/api/projects/active/${encodeURIComponent(channel)}`);
      const activePayload = activeResponse.ok ? await activeResponse.json() : {};
      const projectName = String(activePayload?.project || 'ai-office').trim() || 'ai-office';
      const activeBranch = String(activePayload?.branch || 'main').trim() || 'main';

      setProject(projectName);
      setCurrentBranch(activeBranch);
      setMergeTarget((prev) => prev || activeBranch);

      const [status, log, diff, branchInfo, checkpointInfo] = await Promise.all([
        run(`/api/projects/${encodeURIComponent(projectName)}/git/status`),
        run(`/api/projects/${encodeURIComponent(projectName)}/git/log`),
        run(`/api/projects/${encodeURIComponent(projectName)}/git/diff`),
        run(`/api/projects/${encodeURIComponent(projectName)}/branches?channel=${encodeURIComponent(channel)}`),
        run(`/api/projects/${encodeURIComponent(projectName)}/checkpoints`),
      ]);

      setStatusText(status.stdout || status.stderr || status.error || '');
      setLogText(log.stdout || log.stderr || log.error || '');
      setDiffText(diff.stdout || diff.stderr || diff.error || '');

      const branchList = Array.isArray(branchInfo?.branches) ? branchInfo.branches : [];
      const active = branchInfo?.active_branch || branchInfo?.current_branch || activeBranch || 'main';
      setBranches(branchList);
      setCurrentBranch(active);
      setMergeTarget((prev) => prev || active);
      if (!mergeSource) {
        const fallback = branchList.find((item) => item !== active) || '';
        setMergeSource(fallback);
      }

      const cpList = Array.isArray(checkpointInfo?.checkpoints) ? checkpointInfo.checkpoints : [];
      setCheckpoints(cpList);

      setNotice('');
    } catch (error) {
      const message = error?.message || 'Failed to load git information.';
      setErrorDetails(message);
      setNotice(message);
    } finally {
      setLoading(false);
    }
  }, [channel, mergeSource, run]);

  const detectCapabilities = useCallback(async () => {
    try {
      const response = await fetch('/openapi.json');
      const payload = response.ok ? await response.json() : {};
      const paths = Object.keys(payload?.paths || {});
      const resolve = (candidates) => paths.find((path) => candidates.some((needle) => path.includes(needle))) || '';

      const stagePath = resolve(['/git/stage', '/git/add']);
      const unstagePath = resolve(['/git/unstage', '/git/reset']);

      setCapabilities({
        stage: Boolean(stagePath),
        unstage: Boolean(unstagePath),
        stagePath,
        unstagePath,
      });
    } catch {
      setCapabilities({
        stage: false,
        unstage: false,
        stagePath: '',
        unstagePath: '',
      });
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      refresh();
      detectCapabilities();
    }, 0);
    return () => clearTimeout(timer);
  }, [refresh, detectCapabilities]);

  const layoutKey = useMemo(
    () => `ai-office:git-layout:${String(project || 'ai-office').toLowerCase()}`,
    [project]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      const raw = localStorage.getItem(layoutKey);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Number.isFinite(parsed.leftRatio)) setLeftRatio(parsed.leftRatio);
          if (Number.isFinite(parsed.centerRatio)) setCenterRatio(parsed.centerRatio);
          if (parsed.compactPane) setCompactPane(parsed.compactPane);
        } catch {
          // ignore parsing failures
        }
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [layoutKey]);

  useEffect(() => {
    localStorage.setItem(
      layoutKey,
      JSON.stringify({
        leftRatio,
        centerRatio,
        compactPane,
      })
    );
  }, [layoutKey, leftRatio, centerRatio, compactPane]);

  useEffect(() => {
    const onResize = () => {
      setIsNarrow(window.innerWidth <= 1160);
    };
    const timer = setTimeout(onResize, 0);
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const diffMap = useMemo(() => parseDiffMap(diffText), [diffText]);
  const parsedStatus = useMemo(() => parseStatus(statusText, diffMap), [statusText, diffMap]);
  const allChanges = useMemo(() => [...parsedStatus.unstaged, ...parsedStatus.staged], [parsedStatus]);

  const activeFilePath = useMemo(() => {
    if (selectedFilePath && allChanges.some((item) => item.path === selectedFilePath)) return selectedFilePath;
    return allChanges[0]?.path || '';
  }, [allChanges, selectedFilePath]);

  const selectedChange = useMemo(
    () => allChanges.find((item) => item.path === activeFilePath) || null,
    [allChanges, activeFilePath]
  );

  const selectedDiff = useMemo(() => {
    if (!selectedChange) return '';
    const fromStatus = selectedChange.diff || '';
    if (fromStatus) return fromStatus;
    const fromMap = diffMap[selectedChange.path]?.text || '';
    return fromMap;
  }, [selectedChange, diffMap]);

  const stagedCount = parsedStatus.staged.length;
  const repoMissing = isRepoMissing(statusText, errorDetails);
  const lastCommit = useMemo(() => summarizeLog(logText), [logText]);
  const commitSuggestion = useMemo(() => inferCommitSuggestion(allChanges), [allChanges]);

  const commitDisabled = !commitMessage.trim() || stagedCount === 0 || commitBusy;

  const applyTemplate = () => {
    setCommitMessage((prev) => {
      if (String(prev).trim()) return prev;
      return `${template}: `;
    });
  };

  const applySuggestion = () => {
    if (!commitSuggestion) return;
    setCommitMessage(commitSuggestion);
  };

  const commitChanges = async () => {
    if (commitDisabled) return;
    setCommitBusy(true);
    try {
      const payload = await run(`/api/projects/${encodeURIComponent(project)}/git/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMessage.trim() }),
      });
      if (payload.ok) {
        setNotice('Commit complete.');
        setCommitMessage('');
        refresh();
      } else {
        setNotice(payload.stderr || payload.error || 'Commit failed.');
      }
    } catch (error) {
      setNotice(error?.message || 'Commit failed.');
    } finally {
      setCommitBusy(false);
    }
  };

  const createBranch = async () => {
    const name = String(newBranchName || '').trim();
    if (!name) return;
    try {
      const payload = await run(`/api/projects/${encodeURIComponent(project)}/git/branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (payload.ok) {
        setNotice(`Created branch ${name}.`);
        setCreateBranchOpen(false);
        setNewBranchName('');
        refresh();
      } else {
        setNotice(payload.stderr || payload.error || 'Branch creation failed.');
      }
    } catch (error) {
      setNotice(error?.message || 'Branch creation failed.');
    }
  };

  const previewMerge = async () => {
    if (!mergeSource || !mergeTarget) return;
    try {
      const payload = await run(`/api/projects/${encodeURIComponent(project)}/merge-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_branch: mergeSource, target_branch: mergeTarget }),
      });
      setMergeResult(payload);
      if (payload.ok && payload.has_conflicts) {
        setNotice(`Merge preview found ${payload.conflicts?.length || 0} conflict(s).`);
      } else if (payload.ok) {
        setNotice('Merge preview is clean.');
      } else {
        setNotice(payload.error || payload.stderr || 'Merge preview failed.');
      }
    } catch (error) {
      setNotice(error?.message || 'Merge preview failed.');
    }
  };

  const applyMerge = async () => {
    if (!mergeSource || !mergeTarget) return;
    const confirmed = window.confirm(`Apply merge ${mergeSource} -> ${mergeTarget}?`);
    if (!confirmed) return;
    try {
      const payload = await run(`/api/projects/${encodeURIComponent(project)}/merge-apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_branch: mergeSource, target_branch: mergeTarget }),
      });
      setMergeResult(payload);
      if (payload.ok) {
        setNotice('Merge apply succeeded.');
        refresh();
      } else {
        setNotice(payload.error || payload.stderr || 'Merge apply failed.');
      }
    } catch (error) {
      setNotice(error?.message || 'Merge apply failed.');
    }
  };

  const createCheckpoint = async () => {
    const name = String(checkpointName || '').trim();
    if (!name) return;
    try {
      const payload = await run(`/api/projects/${encodeURIComponent(project)}/checkpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, note: checkpointNote.trim() || null }),
      });
      if (payload.ok) {
        setCheckpointCreateOpen(false);
        setCheckpointName('');
        setCheckpointNote('');
        setNotice('Checkpoint created.');
        refresh();
      } else {
        setNotice(payload.error || payload.stderr || 'Checkpoint create failed.');
      }
    } catch (error) {
      setNotice(error?.message || 'Checkpoint create failed.');
    }
  };

  const deleteCheckpoint = async (checkpoint) => {
    const id = checkpoint?.id;
    if (!id) return;
    const confirmed = window.confirm('Delete this checkpoint reference?');
    if (!confirmed) return;
    try {
      const payload = await run(`/api/projects/${encodeURIComponent(project)}/checkpoints/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (payload.ok) {
        setNotice('Checkpoint deleted.');
        refresh();
      } else {
        setNotice(payload.error || payload.stderr || 'Checkpoint delete failed.');
      }
    } catch (error) {
      setNotice(error?.message || 'Checkpoint delete failed.');
    }
  };

  const startRestoreCheckpoint = (checkpoint) => {
    setRestoreModal({ open: true, checkpoint, confirm: '' });
  };

  const confirmRestoreCheckpoint = async () => {
    if (!restoreModal.checkpoint?.id) return;
    try {
      const payload = await run(`/api/projects/${encodeURIComponent(project)}/checkpoints/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkpoint_id: restoreModal.checkpoint.id,
          confirm: restoreModal.confirm,
        }),
      });
      if (payload.ok) {
        setNotice('Checkpoint restored.');
        setRestoreModal({ open: false, checkpoint: null, confirm: '' });
        refresh();
      } else {
        setNotice(payload.error || payload.stderr || 'Checkpoint restore failed.');
      }
    } catch (error) {
      setNotice(error?.message || 'Checkpoint restore failed.');
    }
  };

  const runStageAction = async (mode, paths, all = false) => {
    const config = mode === 'stage'
      ? { enabled: capabilities.stage, template: capabilities.stagePath || '/api/projects/{name}/git/stage' }
      : { enabled: capabilities.unstage, template: capabilities.unstagePath || '/api/projects/{name}/git/unstage' };

    if (!config.enabled) return;
    try {
      const payload = await run(materializePath(config.template, project), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          all
            ? { all: true }
            : { paths: Array.isArray(paths) ? paths : [paths] }
        ),
      });
      if (payload.ok === false) {
        setNotice(payload.error || payload.stderr || `${mode} action failed.`);
      } else {
        setNotice(mode === 'stage' ? 'Staged changes.' : 'Unstaged changes.');
        refresh();
      }
    } catch (error) {
      setNotice(error?.message || `${mode} action failed.`);
    }
  };

  const copyDiff = () => {
    if (!selectedDiff) return;
    if (!navigator?.clipboard?.writeText) {
      setNotice('Clipboard API unavailable in this environment.');
      return;
    }
    navigator.clipboard
      .writeText(selectedDiff)
      .then(() => setNotice('Diff copied to clipboard.'))
      .catch(() => setNotice('Failed to copy diff.'));
  };

  const copyErrorDetails = () => {
    const text = [errorDetails, notice].filter(Boolean).join('\n');
    if (!text || !navigator?.clipboard?.writeText) return;
    navigator.clipboard
      .writeText(text)
      .then(() => setNotice('Error details copied.'))
      .catch(() => setNotice('Failed to copy error details.'));
  };

  const renderChangesPanel = () => (
    <section className="git-panel-col git-panel-changes">
      <header className="git-col-header">
        <h3>Changes</h3>
        <span>{allChanges.length} files</span>
      </header>
      {repoMissing ? (
        <div className="git-empty-state">
          <h4>Git repository not initialized</h4>
          <p>This project path is not currently a Git repository.</p>
          <button type="button" className="ui-btn" disabled title="Initialize endpoint is not available in this build.">
            Initialize Git (coming soon)
          </button>
        </div>
      ) : (
        <ChangesList
          unstaged={parsedStatus.unstaged}
          staged={parsedStatus.staged}
          selectedPath={activeFilePath}
          onSelectFile={setSelectedFilePath}
          stageSupported={capabilities.stage}
          unstageSupported={capabilities.unstage}
          onStageAll={() => runStageAction('stage', [], true)}
          onUnstageAll={() => runStageAction('unstage', [], true)}
          onStageFile={(path) => runStageAction('stage', [path], false)}
          onUnstageFile={(path) => runStageAction('unstage', [path], false)}
        />
      )}
    </section>
  );

  const renderDiffPanel = () => (
    <section className="git-panel-col git-panel-diff">
      <header className="git-col-header">
        <h3>Diff</h3>
        <span>{activeFilePath || 'No file selected'}</span>
      </header>
      {repoMissing ? (
        <div className="git-empty-state">
          <h4>No diff available</h4>
          <p>Initialize a repository first, then refresh this panel.</p>
        </div>
      ) : allChanges.length === 0 ? (
        <div className="git-empty-state">
          <h4>{beginnerMode ? 'No changes yet' : 'No changes'}</h4>
          <p>
            {beginnerMode
              ? 'Edit files first, then return here to review and commit your work.'
              : 'Working tree is clean. You are ready to pull, branch, or start a new checkpoint.'}
          </p>
          {beginnerMode ? (
            <div className="beginner-empty-actions">
              <button type="button" className="ui-btn ui-btn-primary" onClick={() => onOpenTab?.('files')}>
                Open Files
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <DiffViewer
          filePath={activeFilePath}
          diffText={selectedDiff}
          viewMode={diffMode}
          onViewModeChange={setDiffMode}
          onCopyDiff={copyDiff}
        />
      )}
    </section>
  );

  const renderActionsPanel = () => (
    <section className="git-panel-col git-panel-actions">
      <CommitPanel
        commitMessage={commitMessage}
        onCommitMessageChange={setCommitMessage}
        selectedTemplate={template}
        onTemplateChange={setTemplate}
        onApplyTemplate={applyTemplate}
        suggestion={commitSuggestion}
        onApplySuggestion={applySuggestion}
        onCommit={commitChanges}
        commitDisabled={commitDisabled}
        stagedCount={stagedCount}
        lastCommit={lastCommit}
        notice={notice}
      />

      <BranchPanel
        beginnerMode={beginnerMode}
        branches={branches}
        currentBranch={currentBranch}
        mergeSource={mergeSource}
        mergeTarget={mergeTarget}
        onMergeSourceChange={setMergeSource}
        onMergeTargetChange={setMergeTarget}
        onPreviewMerge={previewMerge}
        onApplyMerge={applyMerge}
        mergeResult={mergeResult}
        createModalOpen={createBranchOpen}
        onOpenCreateModal={() => setCreateBranchOpen(true)}
        onCloseCreateModal={() => setCreateBranchOpen(false)}
        newBranchName={newBranchName}
        onNewBranchNameChange={setNewBranchName}
        onCreateBranch={createBranch}
      />

      <CheckpointPanel
        checkpoints={checkpoints}
        onRestore={startRestoreCheckpoint}
        onDelete={deleteCheckpoint}
      />
    </section>
  );

  return (
    <div className="panel git-v2-shell">
      <header className="panel-header git-v2-header">
        <div className="git-v2-title">
          <h3>Git</h3>
          <p>
            Project: <strong>{project}</strong> · Branch: <strong>{currentBranch || 'main'}</strong>
          </p>
        </div>
        <div className="git-v2-actions">
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => setCheckpointCreateOpen(true)}>
            Checkpoint
          </button>
          <button type="button" className="ui-btn" onClick={refresh} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {errorDetails ? (
        <div className="git-error-banner">
          <div>
            <strong>Git panel error</strong>
            <p>{errorDetails}</p>
          </div>
          <button type="button" className="ui-btn" onClick={copyErrorDetails}>
            Copy details
          </button>
        </div>
      ) : null}

      {isNarrow ? (
        <div className="git-compact-shell">
          <div className="git-compact-tabs">
            <button
              type="button"
              className={`ui-btn ${compactPane === 'changes' ? 'ui-btn-primary' : ''}`}
              onClick={() => setCompactPane('changes')}
            >
              Changes
            </button>
            <button
              type="button"
              className={`ui-btn ${compactPane === 'diff' ? 'ui-btn-primary' : ''}`}
              onClick={() => setCompactPane('diff')}
            >
              Diff
            </button>
            <button
              type="button"
              className={`ui-btn ${compactPane === 'actions' ? 'ui-btn-primary' : ''}`}
              onClick={() => setCompactPane('actions')}
            >
              Commit & Branch
            </button>
          </div>
          <div className="git-compact-body">
            {compactPane === 'changes' && renderChangesPanel()}
            {compactPane === 'diff' && renderDiffPanel()}
            {compactPane === 'actions' && renderActionsPanel()}
          </div>
        </div>
      ) : (
        <div className="git-layout">
          <SplitPane
            direction="vertical"
            ratio={leftRatio}
            defaultRatio={0.26}
            minPrimary={260}
            minSecondary={560}
            onRatioChange={setLeftRatio}
          >
            {renderChangesPanel()}
            <SplitPane
              direction="vertical"
              ratio={centerRatio}
              defaultRatio={0.66}
              minPrimary={420}
              minSecondary={320}
              onRatioChange={setCenterRatio}
            >
              {renderDiffPanel()}
              {renderActionsPanel()}
            </SplitPane>
          </SplitPane>
        </div>
      )}

      {checkpointCreateOpen ? (
        <div className="git-modal-backdrop" onClick={() => setCheckpointCreateOpen(false)}>
          <div className="git-modal-card" onClick={(event) => event.stopPropagation()}>
            <h4>Create Checkpoint</h4>
            <p>This creates a rollback marker before risky edits.</p>
            <input
              autoFocus
              type="text"
              value={checkpointName}
              onChange={(event) => setCheckpointName(event.target.value)}
              placeholder="Checkpoint name"
            />
            <textarea
              value={checkpointNote}
              onChange={(event) => setCheckpointNote(event.target.value)}
              placeholder="Note (optional)"
            />
            <div className="git-modal-actions">
              <button type="button" className="ui-btn" onClick={() => setCheckpointCreateOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-primary"
                onClick={createCheckpoint}
                disabled={!String(checkpointName || '').trim()}
              >
                Create checkpoint
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {restoreModal.open ? (
        <div className="git-modal-backdrop" onClick={() => setRestoreModal({ open: false, checkpoint: null, confirm: '' })}>
          <div className="git-modal-card" onClick={(event) => event.stopPropagation()}>
            <h4>Restore checkpoint</h4>
            <p>
              You are restoring <strong>{restoreModal.checkpoint?.name || restoreModal.checkpoint?.id}</strong>.
              This may discard local uncommitted changes.
            </p>
            <label>
              Type <code>RESTORE</code> to continue
              <input
                type="text"
                value={restoreModal.confirm}
                onChange={(event) =>
                  setRestoreModal((prev) => ({ ...prev, confirm: event.target.value }))
                }
                placeholder="RESTORE"
              />
            </label>
            <div className="git-modal-actions">
              <button
                type="button"
                className="ui-btn"
                onClick={() => setRestoreModal({ open: false, checkpoint: null, confirm: '' })}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-primary"
                onClick={confirmRestoreCheckpoint}
                disabled={restoreModal.confirm.trim() !== 'RESTORE'}
              >
                Restore now
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
