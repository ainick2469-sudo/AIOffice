import { useCallback, useEffect, useMemo, useState } from 'react';

export default function ProjectPanel({ channel = 'main', onProjectSwitch }) {
  const [projects, setProjects] = useState([]);
  const [active, setActive] = useState({ project: 'ai-office', path: '', branch: 'main' });
  const [newName, setNewName] = useState('');
  const [template, setTemplate] = useState('');
  const [status, setStatus] = useState('');
  const [branches, setBranches] = useState([]);
  const [branchInput, setBranchInput] = useState('');
  const [mergeSource, setMergeSource] = useState('');
  const [mergeTarget, setMergeTarget] = useState('main');
  const [mergePreview, setMergePreview] = useState(null);
  const [branchBusy, setBranchBusy] = useState({ refresh: false, switch: false, preview: false, apply: false });
  const [buildConfig, setBuildConfig] = useState({ build_cmd: '', test_cmd: '', run_cmd: '' });
  const [running, setRunning] = useState({ build: false, test: false, run: false });
  const [result, setResult] = useState(null);
  const [autonomyMode, setAutonomyMode] = useState('SAFE');
  const [savingMode, setSavingMode] = useState(false);
  const [processes, setProcesses] = useState([]);
  const [processLoading, setProcessLoading] = useState(false);
  const [processCommand, setProcessCommand] = useState('');
  const [processName, setProcessName] = useState('');
  const [processBusy, setProcessBusy] = useState({ start: false, kill: false });
  const [expandedProcessId, setExpandedProcessId] = useState(null);

  const activeProjectName = active?.project || 'ai-office';

  const load = useCallback(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then((data) => setProjects(data.projects || []))
      .catch(() => {});
    fetch(`/api/projects/active/${channel}`)
      .then(r => r.json())
      .then((data) => setActive(data || { project: 'ai-office', path: '', branch: 'main' }))
      .catch(() => {});
  }, [channel]);

  const loadBranches = useCallback((projectName) => {
    const project = projectName || activeProjectName;
    if (!project) return;
    setBranchBusy(prev => ({ ...prev, refresh: true }));
    fetch(`/api/projects/${project}/branches?channel=${encodeURIComponent(channel)}`)
      .then(r => r.json())
      .then((data) => {
        if (data?.detail) throw new Error(data.detail);
        const list = Array.isArray(data?.branches) ? data.branches : [];
        setBranches(list);
        const activeBranch = data?.active_branch || data?.current_branch || 'main';
        setActive(prev => ({ ...prev, branch: activeBranch }));
        setMergeTarget(activeBranch);
        if (!mergeSource && list.length > 0) {
          const fallback = list.find((item) => item !== activeBranch) || list[0];
          setMergeSource(fallback);
        }
      })
      .catch(() => setBranches([]))
      .finally(() => setBranchBusy(prev => ({ ...prev, refresh: false })));
  }, [activeProjectName, channel, mergeSource]);

  const loadAutonomyMode = useCallback((projectName) => {
    fetch(`/api/projects/${projectName}/autonomy-mode`)
      .then(r => (r.ok ? r.json() : { mode: 'SAFE' }))
      .then((data) => setAutonomyMode(data?.mode || 'SAFE'))
      .catch(() => setAutonomyMode('SAFE'));
  }, []);

  const loadProcesses = useCallback((includeLogs = false) => {
    setProcessLoading(true);
    const suffix = includeLogs ? '?include_logs=true' : '';
    fetch(`/api/process/list/${channel}${suffix}`)
      .then(r => r.json())
      .then((data) => setProcesses(Array.isArray(data?.processes) ? data.processes : []))
      .catch(() => setProcesses([]))
      .finally(() => setProcessLoading(false));
  }, [channel]);

  const loadBuildConfig = (projectName) => {
    fetch(`/api/projects/${projectName}/build-config`)
      .then(r => r.json())
      .then((data) => {
        const cfg = data?.config || {};
        setBuildConfig({
          build_cmd: cfg.build_cmd || '',
          test_cmd: cfg.test_cmd || '',
          run_cmd: cfg.run_cmd || '',
        });
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!activeProjectName) return;
    loadBuildConfig(activeProjectName);
    loadAutonomyMode(activeProjectName);
    const timer = setTimeout(() => {
      loadBranches(activeProjectName);
    }, 0);
    return () => clearTimeout(timer);
  }, [activeProjectName, loadAutonomyMode, loadBranches]);

  useEffect(() => {
    const immediate = setTimeout(() => {
      loadProcesses(Boolean(expandedProcessId));
    }, 0);
    const interval = setInterval(() => {
      loadProcesses(Boolean(expandedProcessId));
    }, 3000);
    return () => {
      clearTimeout(immediate);
      clearInterval(interval);
    };
  }, [expandedProcessId, loadProcesses]);

  const projectNames = useMemo(() => projects.map(p => p.name), [projects]);

  const createProject = () => {
    const name = newName.trim().toLowerCase();
    if (!name) return;
    setStatus('Creating project...');
    fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, template: template || null }),
    })
      .then(r => r.json())
      .then((data) => {
        if (data?.detail) throw new Error(data.detail);
        setNewName('');
        setStatus(`Created project ${name}.`);
        load();
      })
      .catch((err) => setStatus(err?.message || 'Failed to create project.'));
  };

  const switchProject = (name) => {
    setStatus(`Switching to ${name}...`);
    fetch('/api/projects/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, name }),
    })
      .then(r => r.json())
      .then((data) => {
        if (data?.detail) throw new Error(data.detail);
        setActive(data.active);
        setStatus(`Active project: ${data.active.project} @ ${data.active.branch || 'main'}`);
        loadBuildConfig(data.active.project);
        loadBranches(data.active.project);
        onProjectSwitch?.(data.active);
      })
      .catch((err) => setStatus(err?.message || 'Failed to switch project.'));
  };

  const switchBranch = (branchName, createIfMissing = false) => {
    const value = (branchName || '').trim();
    if (!value) return;
    setBranchBusy(prev => ({ ...prev, switch: true }));
    setStatus(`Switching branch to ${value}...`);
    fetch(`/api/projects/${activeProjectName}/branches/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel,
        branch: value,
        create_if_missing: Boolean(createIfMissing),
      }),
    })
      .then(r => r.json())
      .then((data) => {
        if (data?.detail) throw new Error(data.detail);
        if (data?.active) {
          setActive(data.active);
          onProjectSwitch?.(data.active);
        } else {
          setActive(prev => ({ ...prev, branch: data?.branch || value }));
        }
        setMergeTarget(data?.branch || value);
        setStatus(`Active branch: ${data?.branch || value}`);
        setBranchInput('');
        loadBranches(activeProjectName);
      })
      .catch((err) => setStatus(err?.message || 'Failed to switch branch.'))
      .finally(() => setBranchBusy(prev => ({ ...prev, switch: false })));
  };

  const previewMerge = () => {
    const sourceBranch = mergeSource.trim();
    const targetBranch = mergeTarget.trim();
    if (!sourceBranch || !targetBranch) return;
    setBranchBusy(prev => ({ ...prev, preview: true }));
    setMergePreview(null);
    fetch(`/api/projects/${activeProjectName}/merge-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_branch: sourceBranch, target_branch: targetBranch }),
    })
      .then(r => r.json())
      .then((data) => {
        if (data?.detail) throw new Error(data.detail);
        setMergePreview(data);
        if (data?.ok) {
          if (data?.has_conflicts) setStatus(`Merge preview found ${data.conflicts?.length || 0} conflict(s).`);
          else setStatus('Merge preview clean.');
        } else {
          setStatus(data?.error || data?.stderr || 'Merge preview failed.');
        }
      })
      .catch((err) => setStatus(err?.message || 'Merge preview failed.'))
      .finally(() => setBranchBusy(prev => ({ ...prev, preview: false })));
  };

  const applyMerge = () => {
    const sourceBranch = mergeSource.trim();
    const targetBranch = mergeTarget.trim();
    if (!sourceBranch || !targetBranch) return;
    const confirmed = window.confirm(`Apply merge ${sourceBranch} -> ${targetBranch}?`);
    if (!confirmed) return;
    setBranchBusy(prev => ({ ...prev, apply: true }));
    fetch(`/api/projects/${activeProjectName}/merge-apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_branch: sourceBranch, target_branch: targetBranch }),
    })
      .then(r => r.json())
      .then((data) => {
        if (data?.detail) throw new Error(data.detail);
        setMergePreview(data);
        if (!data?.ok) {
          setStatus(data?.error || data?.stderr || 'Merge apply failed.');
          return;
        }
        setStatus(`Merge applied (${sourceBranch} -> ${targetBranch}).`);
        loadBranches(activeProjectName);
      })
      .catch((err) => setStatus(err?.message || 'Merge apply failed.'))
      .finally(() => setBranchBusy(prev => ({ ...prev, apply: false })));
  };

  const deleteProject = (name) => {
    setStatus(`Requesting delete token for ${name}...`);
    fetch(`/api/projects/${name}`, { method: 'DELETE' })
      .then(r => r.json())
      .then((first) => {
        if (first?.detail) throw new Error(first.detail);
        if (!first?.requires_confirmation) {
          setStatus(`Deleted ${name}.`);
          load();
          return;
        }
        return fetch(`/api/projects/${name}?confirm_token=${encodeURIComponent(first.confirm_token)}`, {
          method: 'DELETE',
        })
          .then(r => r.json())
          .then((second) => {
            if (second?.detail) throw new Error(second.detail);
            setStatus(`Deleted ${name}.`);
            load();
          });
      })
      .catch((err) => setStatus(err?.message || 'Failed to delete project.'));
  };

  const saveBuildConfig = () => {
    setStatus(`Saving build config for ${activeProjectName}...`);
    fetch(`/api/projects/${activeProjectName}/build-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildConfig),
    })
      .then(r => r.json())
      .then((data) => {
        if (data?.detail) throw new Error(data.detail);
        setStatus('Build config saved.');
      })
      .catch((err) => setStatus(err?.message || 'Failed to save build config.'));
  };

  const runStage = (stage) => {
    const endpoint = stage === 'build' ? 'build' : stage === 'test' ? 'test' : 'run';
    setRunning(prev => ({ ...prev, [stage]: true }));
    setResult(null);
    fetch(`/api/projects/${activeProjectName}/${endpoint}`, { method: 'POST' })
      .then(r => r.json())
      .then((data) => {
        setResult({ stage, ...data });
        if (data?.detail) throw new Error(data.detail);
        setStatus(`${stage} ${data.ok ? 'passed' : 'failed'}.`);
      })
      .catch((err) => {
        setStatus(err?.message || `${stage} failed.`);
      })
      .finally(() => setRunning(prev => ({ ...prev, [stage]: false })));
  };

  const saveAutonomyMode = () => {
    setSavingMode(true);
    setStatus(`Saving autonomy mode ${autonomyMode}...`);
    fetch(`/api/projects/${activeProjectName}/autonomy-mode`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: autonomyMode }),
    })
      .then(r => r.json())
      .then((data) => {
        if (data?.detail) throw new Error(data.detail);
        setStatus(`Autonomy mode updated to ${data.mode}.`);
      })
      .catch((err) => setStatus(err?.message || 'Failed to save autonomy mode.'))
      .finally(() => setSavingMode(false));
  };

  const startProcess = () => {
    const command = processCommand.trim();
    if (!command) return;
    setProcessBusy(prev => ({ ...prev, start: true }));
    setStatus('Starting process...');
    fetch('/api/process/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel,
        command,
        name: processName.trim() || null,
        project: activeProjectName,
      }),
    })
      .then(r => r.json())
      .then((data) => {
        if (data?.detail) throw new Error(data.detail);
        setProcessCommand('');
        setProcessName('');
        setStatus(`Started process ${data?.process?.name || ''}.`);
        loadProcesses();
      })
      .catch((err) => setStatus(err?.message || 'Failed to start process.'))
      .finally(() => setProcessBusy(prev => ({ ...prev, start: false })));
  };

  const stopProcess = (processId) => {
    fetch('/api/process/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, process_id: processId }),
    })
      .then(r => r.json())
      .then((data) => {
        if (data?.detail) throw new Error(data.detail);
        setStatus(`Stopped process ${processId}.`);
        loadProcesses();
      })
      .catch((err) => setStatus(err?.message || 'Failed to stop process.'));
  };

  const toggleProcessLogs = (processId) => {
    if (expandedProcessId === processId) {
      setExpandedProcessId(null);
      return;
    }
    setExpandedProcessId(processId);
    loadProcesses(true);
  };

  const killSwitch = () => {
    const confirmed = window.confirm('Kill switch will stop all processes and set autonomy mode to SAFE. Continue?');
    if (!confirmed) return;
    setProcessBusy(prev => ({ ...prev, kill: true }));
    fetch('/api/process/kill-switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel }),
    })
      .then(r => r.json())
      .then((data) => {
        if (data?.detail) throw new Error(data.detail);
        setAutonomyMode(data?.autonomy_mode || 'SAFE');
        setStatus(`Kill switch complete. Stopped ${data?.stopped_count || 0} process(es).`);
        loadProcesses();
      })
      .catch((err) => setStatus(err?.message || 'Kill switch failed.'))
      .finally(() => setProcessBusy(prev => ({ ...prev, kill: false })));
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Projects</h3>
      </div>
      <div className="panel-body project-panel">
        <div className="project-active">
          <strong>Active:</strong> {activeProjectName} @ {active?.branch || 'main'}
          {active?.path && <span className="project-path">{active.path}</span>}
        </div>

        <div className="project-create-row">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="new-project-name"
          />
          <select value={template} onChange={(e) => setTemplate(e.target.value)}>
            <option value="">No template</option>
            <option value="react">React</option>
            <option value="python">Python</option>
            <option value="rust">Rust</option>
          </select>
          <button onClick={createProject}>Create</button>
          <button onClick={() => switchProject('ai-office')}>Use App Root</button>
        </div>

        <div className="project-list">
          {projectNames.length === 0 && <div className="panel-empty">No projects yet.</div>}
          {projects.map(project => (
            <div key={project.name} className="project-item">
              <div className="project-item-main">
                <div className="project-name">{project.name}</div>
                <div className="project-path">{project.path}</div>
              </div>
              <div className="project-item-actions">
                <button onClick={() => switchProject(project.name)}>Switch</button>
                <button className="danger" onClick={() => deleteProject(project.name)}>Delete</button>
              </div>
            </div>
          ))}
        </div>

        <div className="project-build-config">
          <h4>Branch Workflow</h4>
          <div className="project-item-actions">
            <button onClick={() => loadBranches(activeProjectName)} disabled={branchBusy.refresh}>
              {branchBusy.refresh ? 'Refreshing...' : 'Refresh Branches'}
            </button>
          </div>
          <label>
            Current Branch
            <select
              value={active?.branch || 'main'}
              onChange={(e) => switchBranch(e.target.value, false)}
              disabled={branchBusy.switch}
            >
              {(branches.length > 0 ? branches : [active?.branch || 'main']).map((branchName) => (
                <option key={branchName} value={branchName}>
                  {branchName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Create/Switch Branch
            <input
              type="text"
              value={branchInput}
              onChange={(e) => setBranchInput(e.target.value)}
              placeholder="feature/new-flow"
            />
          </label>
          <div className="project-item-actions">
            <button onClick={() => switchBranch(branchInput, true)} disabled={branchBusy.switch || !branchInput.trim()}>
              {branchBusy.switch ? 'Working...' : 'Create + Switch'}
            </button>
            <button onClick={() => switchBranch(branchInput, false)} disabled={branchBusy.switch || !branchInput.trim()}>
              {branchBusy.switch ? 'Working...' : 'Switch Existing'}
            </button>
          </div>
          <label>
            Merge Source
            <select value={mergeSource} onChange={(e) => setMergeSource(e.target.value)}>
              <option value="">Select source branch</option>
              {branches
                .filter((branchName) => branchName !== mergeTarget)
                .map((branchName) => (
                  <option key={`source-${branchName}`} value={branchName}>
                    {branchName}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Merge Target
            <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
              <option value="">Select target branch</option>
              {branches.map((branchName) => (
                <option key={`target-${branchName}`} value={branchName}>
                  {branchName}
                </option>
              ))}
            </select>
          </label>
          <div className="project-item-actions">
            <button onClick={previewMerge} disabled={branchBusy.preview || !mergeSource || !mergeTarget}>
              {branchBusy.preview ? 'Previewing...' : 'Merge Preview'}
            </button>
            <button onClick={applyMerge} disabled={branchBusy.apply || !mergeSource || !mergeTarget}>
              {branchBusy.apply ? 'Applying...' : 'Merge Apply'}
            </button>
          </div>
          {mergePreview && (
            <pre className="project-result">
              {JSON.stringify(mergePreview, null, 2)}
            </pre>
          )}
        </div>

        <div className="project-build-config">
          <h4>Build / Test / Run Config</h4>
          <label>
            Build
            <input
              type="text"
              value={buildConfig.build_cmd}
              onChange={(e) => setBuildConfig(prev => ({ ...prev, build_cmd: e.target.value }))}
              placeholder="npm run build"
            />
          </label>
          <label>
            Test
            <input
              type="text"
              value={buildConfig.test_cmd}
              onChange={(e) => setBuildConfig(prev => ({ ...prev, test_cmd: e.target.value }))}
              placeholder="npm test"
            />
          </label>
          <label>
            Run
            <input
              type="text"
              value={buildConfig.run_cmd}
              onChange={(e) => setBuildConfig(prev => ({ ...prev, run_cmd: e.target.value }))}
              placeholder="npm run dev"
            />
          </label>
          <div className="project-item-actions">
            <button onClick={saveBuildConfig}>Save Config</button>
            <button onClick={() => runStage('build')} disabled={running.build}>Build</button>
            <button onClick={() => runStage('test')} disabled={running.test}>Test</button>
            <button onClick={() => runStage('run')} disabled={running.run}>Run</button>
          </div>
        </div>

        <div className="project-build-config">
          <h4>Autonomy Mode</h4>
          <label>
            Mode
            <select value={autonomyMode} onChange={(e) => setAutonomyMode(e.target.value)}>
              <option value="SAFE">SAFE</option>
              <option value="TRUSTED">TRUSTED</option>
              <option value="ELEVATED">ELEVATED</option>
            </select>
          </label>
          <div className="project-item-actions">
            <button onClick={saveAutonomyMode} disabled={savingMode}>
              {savingMode ? 'Saving...' : 'Save Mode'}
            </button>
            <button className="danger" onClick={killSwitch} disabled={processBusy.kill}>
              {processBusy.kill ? 'Stopping...' : 'Kill Switch'}
            </button>
          </div>
        </div>

        <div className="project-build-config">
          <h4>Process Manager</h4>
          <label>
            Command
            <input
              type="text"
              value={processCommand}
              onChange={(e) => setProcessCommand(e.target.value)}
              placeholder="python -m uvicorn app:app --reload"
            />
          </label>
          <label>
            Name (optional)
            <input
              type="text"
              value={processName}
              onChange={(e) => setProcessName(e.target.value)}
              placeholder="dev-server"
            />
          </label>
          <div className="project-item-actions">
            <button onClick={startProcess} disabled={processBusy.start || !processCommand.trim()}>
              {processBusy.start ? 'Starting...' : 'Start Process'}
            </button>
            <button onClick={() => loadProcesses(Boolean(expandedProcessId))} disabled={processLoading}>
              {processLoading ? 'Refreshing...' : 'Refresh Processes'}
            </button>
            <button className="danger" onClick={killSwitch} disabled={processBusy.kill}>
              {processBusy.kill ? 'Stopping...' : 'Stop All (Kill Switch)'}
            </button>
          </div>
          <div className="project-process-list">
            {processes.length === 0 && <div className="panel-empty">No running processes.</div>}
            {processes.map((proc) => (
              <div key={proc.id} className="project-process-item">
                <div className="project-process-main">
                  <div className="project-process-title">
                    {proc.name} [{proc.status}]
                  </div>
                  <div className="project-path">{proc.command}</div>
                  <div className="project-path">pid={proc.pid || '-'} cwd={proc.cwd || '-'}</div>
                  <div className="project-path">
                    port={proc.port || '-'} policy={proc.policy_mode || '-'} approval={proc.permission_mode || '-'}
                  </div>
                </div>
                <div className="project-item-actions">
                  {proc.status === 'running' && (
                    <button className="danger" onClick={() => stopProcess(proc.id)}>Stop</button>
                  )}
                  <button onClick={() => toggleProcessLogs(proc.id)}>
                    {expandedProcessId === proc.id ? 'Hide Logs' : 'View Logs'}
                  </button>
                  {proc.port && proc.status === 'running' && (
                    <button onClick={() => window.open(`http://127.0.0.1:${proc.port}`, '_blank')}>
                      Open URL
                    </button>
                  )}
                </div>
                {expandedProcessId === proc.id && (
                  <pre className="project-result">
                    {Array.isArray(proc.logs) && proc.logs.length > 0
                      ? proc.logs.join('\n')
                      : 'No process logs captured yet.'}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>

        {status && <div className="builder-status">{status}</div>}
        {result && (
          <pre className="project-result">
            {`[${result.stage}] exit=${result.exit_code}\n`}
            {result.stdout || result.stderr || result.error || ''}
          </pre>
        )}
      </div>
    </div>
  );
}
