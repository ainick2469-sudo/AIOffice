import { useCallback, useEffect, useMemo, useState } from 'react';

export default function ProjectPanel({ channel = 'main', onProjectSwitch }) {
  const [projects, setProjects] = useState([]);
  const [active, setActive] = useState({ project: 'ai-office', path: '' });
  const [newName, setNewName] = useState('');
  const [template, setTemplate] = useState('');
  const [status, setStatus] = useState('');
  const [buildConfig, setBuildConfig] = useState({ build_cmd: '', test_cmd: '', run_cmd: '' });
  const [running, setRunning] = useState({ build: false, test: false, run: false });
  const [result, setResult] = useState(null);

  const activeProjectName = active?.project || 'ai-office';

  const load = useCallback(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then((data) => setProjects(data.projects || []))
      .catch(() => {});
    fetch(`/api/projects/active/${channel}`)
      .then(r => r.json())
      .then((data) => setActive(data || { project: 'ai-office', path: '' }))
      .catch(() => {});
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
  }, [activeProjectName]);

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
        setStatus(`Active project: ${data.active.project}`);
        loadBuildConfig(data.active.project);
        onProjectSwitch?.(data.active);
      })
      .catch((err) => setStatus(err?.message || 'Failed to switch project.'));
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

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Projects</h3>
      </div>
      <div className="panel-body project-panel">
        <div className="project-active">
          <strong>Active:</strong> {activeProjectName}
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
