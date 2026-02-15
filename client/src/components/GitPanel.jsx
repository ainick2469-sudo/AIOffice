import { useCallback, useEffect, useState } from 'react';

export default function GitPanel({ channel = 'main' }) {
  const [project, setProject] = useState('ai-office');
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
        setProject(name);
        return Promise.all([
          run(`/api/projects/${name}/git/status`),
          run(`/api/projects/${name}/git/log`),
          run(`/api/projects/${name}/git/diff`),
        ]);
      })
      .then(([status, log, diff]) => {
        setStatusText(status.stdout || status.stderr || status.error || '');
        setLogText(log.stdout || log.stderr || log.error || '');
        setDiffText(diff.stdout || diff.stderr || diff.error || '');
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

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Git</h3>
        <button className="refresh-btn" onClick={refresh}>Refresh</button>
      </div>
      <div className="panel-body project-panel">
        <div className="project-active">
          <strong>Project:</strong> {project}
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
