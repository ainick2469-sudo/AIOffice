import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PreviewToolbar from './preview/PreviewToolbar';
import SetupAssistant from './preview/SetupAssistant';
import LogViewer from './preview/LogViewer';
import DesignModeToggle from './preview/DesignModeToggle';
import SelectionInspector from './preview/SelectionInspector';
import { PICKER_INJECTION_SCRIPT } from './preview/designMode/pickerOverlay';
import '../styles/preview.css';

const LOCAL_URL_PATTERN = /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d{2,5})?(?:\/[^\s"']*)?)/gi;

function normalizePort(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const port = Math.trunc(n);
  if (port < 1 || port > 65535) return null;
  return port;
}

function normalizeLocalUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text);
    if (parsed.hostname === '0.0.0.0') parsed.hostname = '127.0.0.1';
    return parsed.toString();
  } catch {
    return '';
  }
}

function extractUrlFromLogs(logs) {
  if (!Array.isArray(logs) || logs.length === 0) return '';
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const line = String(logs[i] || '');
    const matches = Array.from(line.matchAll(LOCAL_URL_PATTERN));
    if (matches.length > 0) {
      const candidate = normalizeLocalUrl(matches[matches.length - 1][1]);
      if (candidate) return candidate;
    }
  }
  return '';
}

function formatTime(epochSeconds) {
  if (!epochSeconds) return '—';
  const date = new Date(Number(epochSeconds) * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString();
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

async function readProjectFile(channel, path) {
  try {
    const resp = await fetch(
      `/api/files/read?channel=${encodeURIComponent(channel)}&path=${encodeURIComponent(path)}`
    );
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok || !payload?.ok) return '';
    return String(payload?.content || '');
  } catch {
    return '';
  }
}

function dedupePresets(presets) {
  const seen = new Set();
  return (presets || []).filter((preset) => {
    const key = `${preset.command}|${preset.port || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createDraftEditRequest({ selection, instruction, previewUrl, project, branch }) {
  const details = selection || {};
  const lines = [
    'Design edit request:',
    `Project: ${project}`,
    `Branch: ${branch}`,
    `Preview URL: ${previewUrl || '(not detected yet)'}`,
    '',
    'Selected element:',
    `- tag: ${details.tag || 'unknown'}`,
    `- id: ${details.id || 'none'}`,
    `- classes: ${Array.isArray(details.classes) && details.classes.length > 0 ? details.classes.join(' ') : 'none'}`,
    `- text: ${(details.text || 'none').slice(0, 80)}`,
    `- dom_path: ${details.path || 'unknown'}`,
    '',
    'Requested changes:',
    instruction || 'Describe the desired visual and behavior changes for this element.',
    '',
    'Please propose a patch, run verification, and summarize exactly what changed.',
  ];
  return lines.join('\n');
}

export default function PreviewPanel({
  channel = 'main',
  onDraftRequest = null,
  beginnerMode = false,
  onStateChange = null,
}) {
  const [activeProject, setActiveProject] = useState('ai-office');
  const [activeBranch, setActiveBranch] = useState('main');
  const [config, setConfig] = useState(null);
  const [draftCmd, setDraftCmd] = useState('');
  const [draftPort, setDraftPort] = useState('');
  const [processes, setProcesses] = useState([]);
  const [selectedProcessId, setSelectedProcessId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [logsOpen, setLogsOpen] = useState(true);
  const [logsSearch, setLogsSearch] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(true);
  const [assistantStackLabel, setAssistantStackLabel] = useState('Unknown');
  const [assistantNotes, setAssistantNotes] = useState([]);
  const [assistantPresets, setAssistantPresets] = useState([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [designMode, setDesignMode] = useState(false);
  const [designUnavailableReason, setDesignUnavailableReason] = useState('');
  const [selection, setSelection] = useState(null);
  const [requestText, setRequestText] = useState('');
  const logsRef = useRef(null);
  const iframeRef = useRef(null);

  const queueNotice = useCallback((value) => {
    setNotice(value);
    if (!value) return;
    window.setTimeout(() => {
      setNotice((prev) => (prev === value ? '' : prev));
    }, 2200);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/active/${encodeURIComponent(channel)}`)
      .then((resp) => (resp.ok ? resp.json() : Promise.reject(new Error('Failed to load active project'))))
      .then((data) => {
        if (cancelled) return;
        const project = String(data?.project || 'ai-office').trim() || 'ai-office';
        const branch = String(data?.branch || 'main').trim() || 'main';
        setActiveProject(project);
        setActiveBranch(branch);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load project context.');
      });
    return () => {
      cancelled = true;
    };
  }, [channel]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${encodeURIComponent(activeProject)}/build-config`)
      .then((resp) => (resp.ok ? resp.json() : Promise.reject(new Error('Failed to load build config'))))
      .then((data) => {
        if (cancelled) return;
        const cfg = data?.config || {};
        setConfig(cfg);
        setDraftCmd(String(cfg.preview_cmd || '').trim() || String(cfg.run_cmd || '').trim());
        setDraftPort(cfg.preview_port == null ? '' : String(cfg.preview_port));
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load build config.');
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetch(`/api/process/list/${encodeURIComponent(channel)}?include_logs=true`)
        .then((resp) => (resp.ok ? resp.json() : { processes: [] }))
        .then((data) => {
          if (cancelled) return;
          const list = Array.isArray(data?.processes) ? data.processes : [];
          setProcesses(list);
        })
        .catch(() => {});
    };
    tick();
    const interval = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [channel, activeProject]);

  useEffect(() => {
    let cancelled = false;
    const detectAssistant = async () => {
      setAssistantLoading(true);
      const notes = [];
      const presets = [];
      let stackLabel = 'Unknown';

      try {
        const treeResp = await fetch(
          `/api/files/tree?channel=${encodeURIComponent(channel)}&path=${encodeURIComponent('.')}`
        );
        const rootTree = (treeResp.ok ? await treeResp.json() : []) || [];
        const names = new Set((Array.isArray(rootTree) ? rootTree : []).map((item) => String(item?.name || '').toLowerCase()));

        const packageText = names.has('package.json')
          ? await readProjectFile(channel, 'package.json')
          : '';
        const requirementsText = names.has('requirements.txt')
          ? await readProjectFile(channel, 'requirements.txt')
          : '';
        const pyprojectText = names.has('pyproject.toml')
          ? await readProjectFile(channel, 'pyproject.toml')
          : '';
        const readmeText = names.has('readme.md')
          ? await readProjectFile(channel, 'README.md')
          : '';

        if (packageText) {
          let pkg = null;
          try {
            pkg = JSON.parse(packageText);
          } catch {
            pkg = null;
          }
          const scripts = pkg?.scripts || {};
          const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
          const devScript = String(scripts.dev || '').toLowerCase();
          const hasVite = Boolean(deps.vite) || devScript.includes('vite');
          const hasNext = Boolean(deps.next) || devScript.includes('next');

          if (hasVite) {
            stackLabel = 'Vite / React';
            presets.push({
              id: 'vite-dev',
              title: 'Vite Dev Server',
              description: 'Runs Vite in local preview mode.',
              command: 'npm run dev -- --host 127.0.0.1 --port 5173',
              port: 5173,
            });
          } else if (hasNext) {
            stackLabel = 'Next.js';
            presets.push({
              id: 'next-dev',
              title: 'Next.js Dev Server',
              description: 'Runs Next with explicit host and port for embedding.',
              command: 'npm run dev -- -H 127.0.0.1 -p 3000',
              port: 3000,
            });
          } else if (scripts.dev || scripts.start) {
            stackLabel = 'Node / Frontend';
            presets.push({
              id: 'node-dev',
              title: 'Node Dev Server',
              description: 'Uses the project dev script with explicit host/port flags.',
              command: 'npm run dev -- --host 127.0.0.1 --port 5173',
              port: 5173,
            });
          }

          notes.push('If dependencies are missing, run npm install once before Start Preview.');
        }

        const pythonHint = `${requirementsText}\n${pyprojectText}`.toLowerCase();
        if (pythonHint.includes('fastapi') || pythonHint.includes('uvicorn')) {
          stackLabel = stackLabel === 'Unknown' ? 'Python / FastAPI' : stackLabel;
          presets.push({
            id: 'fastapi-app',
            title: 'FastAPI (app:app)',
            description: 'Runs uvicorn on app:app with local host and explicit port.',
            command: 'python -m uvicorn app:app --host 127.0.0.1 --port 8000',
            port: 8000,
          });
          presets.push({
            id: 'fastapi-main',
            title: 'FastAPI (main:app)',
            description: 'Fallback if your entry module is main.py.',
            command: 'python -m uvicorn main:app --host 127.0.0.1 --port 8000',
            port: 8000,
          });
        }

        if (stackLabel === 'Unknown' && readmeText) {
          const lower = readmeText.toLowerCase();
          if (lower.includes('vite')) stackLabel = 'Vite / Frontend';
          if (lower.includes('next')) stackLabel = 'Next.js';
          if (lower.includes('fastapi')) stackLabel = 'FastAPI';
        }

        const cfgCommand = String(config?.preview_cmd || '').trim() || String(config?.run_cmd || '').trim();
        const cfgPort = normalizePort(config?.preview_port);
        if (cfgCommand) {
          presets.unshift({
            id: 'saved-config',
            title: 'Saved Project Config',
            description: 'Uses your saved preview command from project settings.',
            command: cfgCommand,
            port: cfgPort || undefined,
          });
        }

        if (presets.length === 0) {
          presets.push({
            id: 'generic-dev',
            title: 'Generic Dev Server',
            description: 'Edit this command in Advanced mode for your stack.',
            command: 'npm run dev -- --host 127.0.0.1 --port 5173',
            port: 5173,
          });
          notes.push('No framework detected yet. Pick a preset and customize command in Advanced mode.');
        }
      } catch {
        stackLabel = 'Unknown';
      }

      if (cancelled) return;
      setAssistantStackLabel(stackLabel);
      setAssistantNotes(notes);
      setAssistantPresets(dedupePresets(presets).slice(0, 3));
      setAssistantLoading(false);
    };
    detectAssistant();
    return () => {
      cancelled = true;
    };
  }, [channel, activeProject, config?.preview_cmd, config?.run_cmd, config?.preview_port]);

  const previewCandidates = useMemo(() => {
    return processes
      .filter((proc) => proc?.status === 'running' || proc?.name === 'preview')
      .filter((proc) => !proc.project || proc.project === activeProject)
      .sort((a, b) => Number(b?.started_at || 0) - Number(a?.started_at || 0));
  }, [processes, activeProject]);

  const selectedProcess = useMemo(() => {
    const byId = previewCandidates.find((proc) => proc.id === selectedProcessId);
    if (byId) return byId;
    const preview = previewCandidates.find((proc) => proc.name === 'preview');
    if (preview) return preview;
    return previewCandidates[0] || null;
  }, [previewCandidates, selectedProcessId]);

  const logs = useMemo(
    () => (Array.isArray(selectedProcess?.logs) ? selectedProcess.logs : []),
    [selectedProcess]
  );

  const filteredLogs = useMemo(() => {
    const term = String(logsSearch || '').trim().toLowerCase();
    const rows = logs.slice(-600);
    if (!term) return rows;
    return rows.filter((line) => String(line || '').toLowerCase().includes(term));
  }, [logs, logsSearch]);

  const detectedPreviewUrl = useMemo(() => extractUrlFromLogs(logs), [logs]);

  useEffect(() => {
    if (!autoScroll || !logsRef.current || !logsOpen) return;
    logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [filteredLogs, autoScroll, logsOpen]);

  const effectivePort = useMemo(() => {
    const fromProcess = selectedProcess?.port ? Number(selectedProcess.port) : null;
    const fromDraft = normalizePort(draftPort);
    const fromConfig = normalizePort(config?.preview_port);
    return fromProcess || fromDraft || fromConfig || null;
  }, [selectedProcess, draftPort, config]);

  const previewUrl = useMemo(() => {
    const fromLog = normalizeLocalUrl(detectedPreviewUrl);
    if (fromLog) return fromLog;
    if (effectivePort) return `http://127.0.0.1:${effectivePort}`;
    return '';
  }, [detectedPreviewUrl, effectivePort]);

  const isRunning = selectedProcess?.status === 'running';
  const statusLabel = isRunning ? 'Running' : selectedProcess?.status === 'exited' ? 'Error' : 'Stopped';
  const statusClass = isRunning ? 'running' : selectedProcess?.status === 'exited' ? 'error' : 'stopped';
  const selectedProcessKey = selectedProcess?.id ? String(selectedProcess.id) : '';

  useEffect(() => {
    onStateChange?.({
      running: isRunning,
      url: previewUrl,
      port: effectivePort,
      processId: selectedProcessKey,
    });
  }, [isRunning, previewUrl, effectivePort, selectedProcessKey, onStateChange]);

  const uptime = useMemo(() => {
    if (!selectedProcess?.started_at) return '—';
    if (isRunning) return `since ${formatTime(selectedProcess.started_at)}`;
    const end = Number(selectedProcess?.ended_at || selectedProcess.started_at);
    return formatDuration(end - Number(selectedProcess.started_at));
  }, [selectedProcess, isRunning]);

  const savePreviewConfig = useCallback(async () => {
    setError('');
    const payload = {
      preview_cmd: String(draftCmd || '').trim(),
      preview_port: normalizePort(draftPort),
    };
    const resp = await fetch(`/api/projects/${encodeURIComponent(activeProject)}/build-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = resp.ok ? await resp.json() : null;
    if (!resp.ok) {
      throw new Error(data?.detail || 'Failed to save preview config.');
    }
    setConfig(data?.config || null);
    queueNotice('Preview config saved.');
  }, [activeProject, draftCmd, draftPort, queueNotice]);

  const startPreview = useCallback(async () => {
    setError('');
    setNotice('');
    const cmd = String(draftCmd || '').trim() || String(config?.run_cmd || '').trim();
    if (!cmd) {
      setError('Set a preview command first (or choose a preset), then click Start.');
      return;
    }

    const resp = await fetch('/api/process/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel,
        command: cmd,
        name: 'preview',
        project: activeProject,
        agent_id: 'user',
        approved: true,
      }),
    });
    const data = resp.ok ? await resp.json() : null;
    if (!resp.ok) {
      setError(data?.detail || 'Failed to start preview process.');
      return;
    }
    queueNotice('Preview started. Watch logs for the live URL.');
    if (data?.process?.id) {
      setSelectedProcessId(String(data.process.id));
    }
  }, [activeProject, channel, config?.run_cmd, draftCmd, queueNotice]);

  const stopPreview = useCallback(async () => {
    if (!selectedProcessKey) return;
    setError('');
    const resp = await fetch('/api/process/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, process_id: selectedProcessKey }),
    });
    const data = resp.ok ? await resp.json() : null;
    if (!resp.ok) {
      setError(data?.detail || 'Failed to stop preview process.');
      return;
    }
    queueNotice('Preview stopped.');
  }, [channel, selectedProcessKey, queueNotice]);

  const restartPreview = useCallback(async () => {
    await stopPreview();
    await startPreview();
  }, [startPreview, stopPreview]);

  const copyToClipboard = useCallback(async (value, successNotice) => {
    try {
      await navigator.clipboard.writeText(value);
      queueNotice(successNotice);
    } catch {
      setError('Clipboard unavailable.');
    }
  }, [queueNotice]);

  const copyPreviewUrl = () => {
    if (!previewUrl) return;
    copyToClipboard(previewUrl, 'Preview URL copied.');
  };

  const openExternal = () => {
    if (!previewUrl) return;
    window.open(previewUrl, '_blank', 'noreferrer');
  };

  const applyPreset = (preset) => {
    setDraftCmd(String(preset?.command || '').trim());
    const nextPort = normalizePort(preset?.port);
    setDraftPort(nextPort ? String(nextPort) : '');
    queueNotice(`Preset applied: ${preset?.title || 'Run preset'}`);
  };

  const injectPicker = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame || !previewUrl) {
      return { ok: false, reason: 'Start preview first, then enable Design Mode.' };
    }
    try {
      const doc = frame.contentDocument || frame.contentWindow?.document;
      if (!doc || !doc.documentElement) {
        return { ok: false, reason: 'Waiting for preview content to load.' };
      }
      let script = doc.getElementById('__ai-office-picker-script');
      if (!script) {
        script = doc.createElement('script');
        script.id = '__ai-office-picker-script';
        script.type = 'text/javascript';
        script.textContent = PICKER_INJECTION_SCRIPT;
        doc.documentElement.appendChild(script);
      }
      frame.contentWindow?.postMessage({ type: 'ai-office-design-mode', enabled: true }, '*');
      return { ok: true, reason: '' };
    } catch {
      return {
        ok: false,
        reason:
          'This preview runs in an isolated origin. Open Preview externally, click what you want, then describe it here.',
      };
    }
  }, [previewUrl]);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === 'ai-office-preview-selection' && event.data?.payload) {
        setSelection(event.data.payload);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const toggleDesignMode = () => {
    if (designMode) {
      setDesignMode(false);
      setDesignUnavailableReason('');
      setSelection(null);
      iframeRef.current?.contentWindow?.postMessage({ type: 'ai-office-design-mode', enabled: false }, '*');
      return;
    }
    const result = injectPicker();
    if (!result.ok) {
      setDesignUnavailableReason(result.reason);
      setDesignMode(false);
      return;
    }
    setDesignUnavailableReason('');
    setDesignMode(true);
  };

  const draftEditRequest = () => {
    const payload = createDraftEditRequest({
      selection,
      instruction: String(requestText || '').trim(),
      previewUrl,
      project: activeProject,
      branch: activeBranch,
    });
    if (typeof onDraftRequest === 'function') {
      onDraftRequest(payload);
      queueNotice('Draft edit request inserted into chat.');
      return;
    }
    copyToClipboard(payload, 'Draft edit request copied.');
  };

  const copyDraftRequest = () => {
    const payload = createDraftEditRequest({
      selection,
      instruction: String(requestText || '').trim(),
      previewUrl,
      project: activeProject,
      branch: activeBranch,
    });
    copyToClipboard(payload, 'Draft edit request copied.');
  };

  return (
    <div className="panel preview-panel preview-v3">
      <div className="panel-header preview-v3-header">
        <div>
          <h3>Preview</h3>
          <p>Step 1 choose setup, Step 2 run preview, Step 3 inspect and draft edits.</p>
        </div>
        <div className="preview-v3-meta">
          <span className="pill ui-chip">Project: {activeProject}</span>
          <span className="pill ui-chip">Branch: {activeBranch}</span>
          <span className={`preview-v3-status ${statusClass}`}>{statusLabel}</span>
        </div>
      </div>

      <div className="panel-body preview-v3-body">
        {beginnerMode && !isRunning && !previewUrl ? (
          <div className="beginner-empty-card">
            <h4>Try this next: start preview in 3 steps</h4>
            <p>Choose a preset, click Start Preview, then open the detected URL.</p>
            <div className="beginner-empty-actions">
              <button
                type="button"
                className="ui-btn ui-btn-primary"
                onClick={() => {
                  if (assistantPresets[0]) {
                    applyPreset(assistantPresets[0]);
                  }
                }}
              >
                Use recommended preset
              </button>
              <button
                type="button"
                className="ui-btn"
                onClick={() => setAdvancedOpen((prev) => !prev)}
              >
                {advancedOpen ? 'Hide Advanced' : 'Show Advanced'}
              </button>
            </div>
          </div>
        ) : null}

        <PreviewToolbar
          statusLabel={statusLabel}
          statusClass={statusClass}
          isRunning={isRunning}
          previewUrl={previewUrl}
          onStart={startPreview}
          onStop={stopPreview}
          onRestart={restartPreview}
          onOpenExternal={openExternal}
          onCopyUrl={copyPreviewUrl}
        />

        <section className="preview-v3-health-row">
          <span className="pill ui-chip">PID: {selectedProcess?.pid || '—'}</span>
          <span className="pill ui-chip">Port: {selectedProcess?.port || effectivePort || '—'}</span>
          <span className="pill ui-chip">Uptime: {uptime}</span>
          <span className="pill ui-chip">Last log: {formatTime(selectedProcess?.ended_at || selectedProcess?.started_at)}</span>
        </section>

        <SetupAssistant
          beginnerMode={beginnerMode}
          loading={assistantLoading}
          stackLabel={assistantStackLabel}
          presets={assistantPresets}
          setupNotes={assistantNotes}
          advancedOpen={advancedOpen}
          onToggleAdvanced={() => setAdvancedOpen((prev) => !prev)}
          onUsePreset={applyPreset}
          draftCmd={draftCmd}
          draftPort={draftPort}
          onDraftCmdChange={setDraftCmd}
          onDraftPortChange={setDraftPort}
          processOptions={previewCandidates}
          selectedProcessId={selectedProcess?.id || ''}
          onSelectProcess={setSelectedProcessId}
          onSaveConfig={() => savePreviewConfig().catch((err) => setError(err?.message || 'Failed to save config.'))}
        />

        <section className="preview-v3-section preview-v3-surface">
          <div className="preview-v3-section-header">
            <div>
              <h4>Live Preview</h4>
              <p>
                {previewUrl
                  ? 'Preview is live. Toggle Design Mode to select elements.'
                  : 'No URL yet. Start preview and watch logs for startup output.'}
              </p>
            </div>
            <DesignModeToggle
              enabled={designMode}
              unavailable={!previewUrl}
              onToggle={toggleDesignMode}
            />
          </div>

          <div className="preview-v3-surface-grid">
            <div className="preview-v3-frame-wrap">
              {previewUrl ? (
                <iframe
                  ref={iframeRef}
                  title="Preview"
                  className="preview-v3-iframe"
                  src={previewUrl}
                  onLoad={() => {
                    if (!designMode) return;
                    const result = injectPicker();
                    if (!result.ok) {
                      setDesignUnavailableReason(result.reason);
                    } else {
                      setDesignUnavailableReason('');
                    }
                  }}
                />
              ) : (
                <div className="preview-v3-empty-state">
                  <strong>{beginnerMode ? 'Preview not running yet' : 'Waiting for server…'}</strong>
                  <span>
                    {beginnerMode
                      ? 'Step 1: apply a run preset. Step 2: click Start Preview. Step 3: watch logs for the live URL.'
                      : 'Set a command and port, click Start Preview, then check logs for startup info.'}
                  </span>
                </div>
              )}
            </div>

            <SelectionInspector
              enabled={designMode}
              unavailableReason={designUnavailableReason}
              selection={selection}
              previewUrl={previewUrl}
              requestText={requestText}
              onRequestTextChange={setRequestText}
              onDraftRequest={draftEditRequest}
              onCopyDraft={copyDraftRequest}
            />
          </div>
        </section>

        <LogViewer
          logsOpen={logsOpen}
          onToggleLogs={() => setLogsOpen((prev) => !prev)}
          logsSearch={logsSearch}
          onLogsSearchChange={setLogsSearch}
          autoScroll={autoScroll}
          onToggleAutoScroll={() => setAutoScroll((prev) => !prev)}
          filteredLogs={filteredLogs}
          logsRef={logsRef}
        />

        <details className="preview-v3-help">
          <summary>Help: command, port, logs, URL</summary>
          <div>
            <p><strong>Command:</strong> the command AI Office uses to run your app server.</p>
            <p><strong>Port:</strong> the local port your app serves on (for example 5173 or 3000).</p>
            <p><strong>Logs:</strong> startup/output stream where server errors and URL hints appear first.</p>
            <p><strong>URL:</strong> detected automatically from logs or process metadata, then used for embedding.</p>
          </div>
        </details>

        {error ? <div className="agent-config-error">{error}</div> : null}
        {notice ? <div className="agent-config-notice">{notice}</div> : null}
      </div>
    </div>
  );
}
