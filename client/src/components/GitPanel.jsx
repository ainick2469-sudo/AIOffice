import { useCallback, useEffect, useState } from 'react';

export default function GitPanel({ channel = 'main' }) {
  const [project, setProject] = useState('ai-office');
  const [currentBranch, setCurrentBranch] = useState('main');
  const [branchList, setBranchList] = useState([]);
  const [mergeSource, setMergeSource] = useState('');
  const [mergeTarget, setMergeTarget] = useState('main');
  const [mergeResult, setMergeResult] = useState(null);
  const [statusText, setStatusText] = useState('');
  const [logText, setLogText] = useState('');
  const [diffText, setDiffText] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [branchName, setBranchName] = useState('');
  const [notice, setNotice] = useState('');

  const run = (url, options = {}) =>
    fetch(url, options)
      .then(r => r.json())
      .then((data) => {
        if (data?.detail) throw new Error(data.detail);
        return data;
      });

  const refresh = useCallback(() => {
    fetch(`/api/projects/active/${channel}`)
      .then(r => r.json())
      .then((data) => {
        const name = data?.project || 'ai-office';
        const activeBranch = data?.branch || 'main';
        setProject(name);
        setCurrentBranch(activeBranch);
        setMergeTarget(activeBranch);
        return Promise.all([
          run(`/api/projects/${name}/git/status`),
          run(`/api/projects/${name}/git/log`),
          run(`/api/projects/${name}/git/diff`),
          run(`/api/projects/${name}/branches?channel=${encodeURIComponent(channel)}`),
        ]);
      })
      .then(([status, log, diff, branches]) => {
        setStatusText(status.stdout || status.stderr || status.error || '');
        setLogText(log.stdout || log.stderr || log.error || '');
        setDiffText(diff.stdout || diff.stderr || diff.error || '');
        const list = Array.isArray(branches?.branches) ? branches.branches : [];
        setBranchList(list);
        const active = branches?.active_branch || branches?.current_branch || 'main';
        setCurrentBranch(active);
        setMergeTarget(active);
        const fallback = list.find((item) => item !== active) || '';
        setMergeSource((prev) => prev || fallback);
      })
      .catch((err) => {
        setNotice(err?.message || 'Failed to load git data.');
      });
  }, [channel]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const commit = () => {
    if (!commitMsg.trim()) return;
    run(`/api/projects/${project}/git/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: commitMsg.trim() }),
    })
      .then((res) => {
        setNotice(res.ok ? 'Commit complete.' : (res.stderr || res.error || 'Commit failed.'));
        if (res.ok) setCommitMsg('');
        refresh();
      })
      .catch((err) => setNotice(err?.message || 'Commit failed.'));
  };

  const createBranch = () => {
    if (!branchName.trim()) return;
    run(`/api/projects/${project}/git/branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: branchName.trim() }),
    })
      .then((res) => {
        setNotice(res.ok ? `Created branch ${branchName.trim()}.` : (res.stderr || res.error || 'Branch failed.'));
        if (res.ok) setBranchName('');
        refresh();
      })
      .catch((err) => setNotice(err?.message || 'Branch creation failed.'));
  };

  const previewMerge = () => {
    const source = mergeSource.trim();
    const target = mergeTarget.trim();
    if (!source || !target) return;
    run(`/api/projects/${project}/merge-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_branch: source, target_branch: target }),
    })
      .then((res) => {
        setMergeResult(res);
        if (res.ok && !res.has_conflicts) setNotice('Merge preview is clean.');
        else if (res.ok && res.has_conflicts) setNotice(`Merge preview found ${res.conflicts?.length || 0} conflict(s).`);
        else setNotice(res.error || res.stderr || 'Merge preview failed.');
      })
      .catch((err) => setNotice(err?.message || 'Merge preview failed.'));
  };

  const applyMerge = () => {
    const source = mergeSource.trim();
    const target = mergeTarget.trim();
    if (!source || !target) return;
    const confirmed = window.confirm(`Apply merge ${source} -> ${target}?`);
    if (!confirmed) return;
    run(`/api/projects/${project}/merge-apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_branch: source, target_branch: target }),
    })
      .then((res) => {
        setMergeResult(res);
        if (res.ok) {
          setNotice('Merge apply succeeded.');
          refresh();
        } else {
          setNotice(res.error || res.stderr || 'Merge apply failed.');
        }
      })
      .catch((err) => setNotice(err?.message || 'Merge apply failed.'));
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Git</h3>
        <button className="refresh-btn" onClick={refresh}>Refresh</button>
      </div>
      <div className="panel-body project-panel">
        <div className="project-active">
          <strong>Project:</strong> {project}
          <div className="project-path">Current branch: {currentBranch || 'main'}</div>
        </div>

        <div className="project-create-row">
          <input
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            placeholder="Commit message"
          />
          <button onClick={commit}>Commit</button>
        </div>

        <div className="project-create-row">
          <input
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            placeholder="new-branch-name"
          />
          <button onClick={createBranch}>Create Branch</button>
        </div>

        <div className="project-build-config">
          <h4>Merge</h4>
          <label>
            Source Branch
            <select value={mergeSource} onChange={(e) => setMergeSource(e.target.value)}>
              <option value="">Select source branch</option>
              {branchList.filter((item) => item !== mergeTarget).map((branch) => (
                <option key={`src-${branch}`} value={branch}>{branch}</option>
              ))}
            </select>
          </label>
          <label>
            Target Branch
            <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
              <option value="">Select target branch</option>
              {branchList.map((branch) => (
                <option key={`tgt-${branch}`} value={branch}>{branch}</option>
              ))}
            </select>
          </label>
          <div className="project-item-actions">
            <button onClick={previewMerge} disabled={!mergeSource || !mergeTarget}>Preview</button>
            <button onClick={applyMerge} disabled={!mergeSource || !mergeTarget}>Apply</button>
          </div>
          {mergeResult?.conflicts?.length > 0 && (
            <pre className="project-result">{`Conflicts:\n${mergeResult.conflicts.join('\n')}`}</pre>
          )}
        </div>

        {notice && <div className="builder-status">{notice}</div>}

        <h4>Status</h4>
        <pre className="project-result">{statusText || '(clean or unavailable)'}</pre>
        <h4>Log</h4>
        <pre className="project-result">{logText || '(no commits or unavailable)'}</pre>
        <h4>Diff</h4>
        <pre className="project-result">{diffText || '(no diff or unavailable)'}</pre>
      </div>
    </div>
  );
}
