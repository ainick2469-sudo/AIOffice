import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PreviewTopBar from './preview/PreviewTopBar';
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

function resolveDeviceWidth(devicePreset) {
  if (devicePreset === 'mobile') return 390;
  if (devicePreset === 'tablet') return 820;
  return null;
}

function resolveStartCommand({ config, draftCmd, draftPort, assistantPresets }) {
  const savedPreviewCmd = String(config?.preview_cmd || '').trim();
  const runCmd = String(config?.run_cmd || '').trim();
  const drafted = String(draftCmd || '').trim();
  const topPreset = assistantPresets?.[0] || null;
  const hasUserOverride = Boolean(drafted && drafted !== savedPreviewCmd && drafted !== runCmd);

  let command = '';
  let source = '';
  let nextPort = normalizePort(config?.preview_port) || null;

  if (savedPreviewCmd) {
    command = savedPreviewCmd;
    source = 'saved-config';
  } else if (hasUserOverride) {
    command = drafted;
    source = 'draft-override';
    nextPort = nextPort || normalizePort(draftPort);
  } else if (topPreset?.command) {
    command = String(topPreset.command).trim();
    source = 'assistant-preset';
    nextPort = nextPort || normalizePort(topPreset.port);
  } else if (runCmd) {
    command = runCmd;
    source = 'run-cmd-fallback';
    nextPort = nextPort || normalizePort(draftPort);
  }

  return { command, source, port: nextPort };
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
  const [logsSearch, setLogsSearch] = useState('');
  const [logsPaused, setLogsPaused] = useState(false);
  const [assistantLoading, setAssistantLoading] = useState(true);
  const [assistantStackLabel, setAssistantStackLabel] = useState('Unknown');
  const [assistantNotes, setAssistantNotes] = useState([]);
  const [assistantPresets, setAssistantPresets] = useState([]);
  const [activeTab, setActiveTab] = useState('preview');
  const [manualUrlInput, setManualUrlInput] = useState('');
  const [manualUrlOverride, setManualUrlOverride] = useState('');
  const [manualUrlOpen, setManualUrlOpen] = useState(false);
  const [showManualHint, setShowManualHint] = useState(false);
  const [designMode, setDesignMode] = useState(false);
  const [designUnavailableReason, setDesignUnavailableReason] = useState('');
  const [selection, setSelection] = useState(null);
  const [requestText, setRequestText] = useState('');
  const [devicePreset, setDevicePreset] = useState('desktop');
  const [frameReloadNonce, setFrameReloadNonce] = useState(0);
  const logsRef = useRef(null);
  const iframeRef = useRef(null);

  const queueNotice = useCallback((value) => {
    setNotice(value);
    if (!value) return;
    window.setTimeout(() => {
      setNotice((prev) => (prev === value ? '' : prev));
    }, 2300);
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
    const includeLogs = activeTab === 'logs';
    if (includeLogs && logsPaused) return undefined;

    const tick = () => {
      const suffix = includeLogs ? '?include_logs=true' : '';
      fetch(`/api/process/list/${encodeURIComponent(channel)}${suffix}`)
        .then((resp) => (resp.ok ? resp.json() : { processes: [] }))
        .then((data) => {
          if (cancelled) return;
          const list = Array.isArray(data?.processes) ? data.processes : [];
          setProcesses(list);
        })
        .catch(() => {});
    };

    tick();
    const interval = setInterval(tick, includeLogs ? 1200 : 1600);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeProject, activeTab, channel, logsPaused]);

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
          notes.push('No framework detected yet. Pick a preset and customize command in Advanced.');
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
  }, [channel, config?.preview_cmd, config?.preview_port, config?.run_cmd]);

  const previewCandidates = useMemo(() => {
    return processes
      .filter((proc) => proc?.status === 'running' || proc?.name === 'preview')
      .filter((proc) => !proc.project || proc.project === activeProject)
      .sort((a, b) => Number(b?.started_at || 0) - Number(a?.started_at || 0));
  }, [processes, activeProject]);

  const selectedProcess = useMemo(() => {
    const byId = previewCandidates.find((proc) => String(proc.id) === String(selectedProcessId));
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
    const rows = logs.slice(-700);
    if (!term) return rows;
    return rows.filter((line) => String(line || '').toLowerCase().includes(term));
  }, [logs, logsSearch]);

  const detectedPreviewUrl = useMemo(() => extractUrlFromLogs(logs), [logs]);
  const selectedProcessPort = normalizePort(selectedProcess?.port);
  const configPort = normalizePort(config?.preview_port);
  const presetPort = normalizePort(assistantPresets?.[0]?.port);
  const effectivePort = selectedProcessPort || configPort || presetPort || null;

  const autoDetectedUrl = useMemo(() => {
    const fromLog = normalizeLocalUrl(detectedPreviewUrl);
    if (fromLog) return fromLog;
    if (effectivePort) return `http://127.0.0.1:${effectivePort}`;
    return '';
  }, [detectedPreviewUrl, effectivePort]);

  const isRunning = selectedProcess?.status === 'running';
  const statusLabel = isRunning ? 'Running' : selectedProcess?.status === 'exited' ? 'Error' : 'Stopped';
  const statusClass = isRunning ? 'running' : selectedProcess?.status === 'exited' ? 'error' : 'stopped';
  const selectedProcessKey = selectedProcess?.id ? String(selectedProcess.id) : '';
  const iframeUrl = manualUrlOverride || autoDetectedUrl;
  const deviceWidth = resolveDeviceWidth(devicePreset);

  useEffect(() => {
    if (!autoScroll || !logsRef.current || activeTab !== 'logs') return;
    logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [filteredLogs, autoScroll, activeTab]);

  useEffect(() => {
    if (!isRunning) {
      setManualUrlOverride('');
      setManualUrlInput('');
      setManualUrlOpen(false);
      setShowManualHint(false);
      return;
    }
    if (autoDetectedUrl || manualUrlOverride) {
      setShowManualHint(false);
      return;
    }
    const timeout = window.setTimeout(() => setShowManualHint(true), 3000);
    return () => window.clearTimeout(timeout);
  }, [autoDetectedUrl, isRunning, manualUrlOverride]);

  useEffect(() => {
    onStateChange?.({
      running: isRunning,
      url: iframeUrl,
      port: effectivePort,
      processId: selectedProcessKey,
    });
  }, [effectivePort, iframeUrl, isRunning, onStateChange, selectedProcessKey]);

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
    queueNotice('Saved. Start Preview to use it.');
  }, [activeProject, draftCmd, draftPort, queueNotice]);

  const startPreview = useCallback(async () => {
    setError('');
    setNotice('');
    setActiveTab('preview');

    const { command, source, port } = resolveStartCommand({
      config,
      draftCmd,
      draftPort,
      assistantPresets,
    });

    if (!command) {
      setError('No preview command configured. Go to Advanced and set a command.');
      setActiveTab('advanced');
      return;
    }

    if (source === 'assistant-preset') {
      setDraftCmd(command);
      if (port) setDraftPort(String(port));
    }

    const resp = await fetch('/api/process/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel,
        command,
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
    queueNotice('Preview started. Waiting for URL...');
    if (data?.process?.id) {
      setSelectedProcessId(String(data.process.id));
    }
  }, [activeProject, assistantPresets, channel, config, draftCmd, draftPort, queueNotice]);

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
  }, [channel, queueNotice, selectedProcessKey]);

  const restartPreview = useCallback(async () => {
    if (isRunning && selectedProcessKey) {
      await stopPreview();
    }
    await startPreview();
  }, [isRunning, selectedProcessKey, startPreview, stopPreview]);

  const copyToClipboard = useCallback(async (value, successNotice) => {
    if (!String(value || '').trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      queueNotice(successNotice);
    } catch {
      setError('Clipboard unavailable.');
    }
  }, [queueNotice]);

  const copyPreviewUrl = () => {
    if (!iframeUrl) return;
    copyToClipboard(iframeUrl, 'Preview URL copied.');
  };

  const openExternal = () => {
    if (!iframeUrl) return;
    window.open(iframeUrl, '_blank', 'noreferrer');
  };

  const applyPreset = (preset) => {
    setDraftCmd(String(preset?.command || '').trim());
    const nextPort = normalizePort(preset?.port);
    setDraftPort(nextPort ? String(nextPort) : '');
    queueNotice(`Preset applied: ${preset?.title || 'Run preset'}`);
  };

  const applyManualUrl = () => {
    const normalized = normalizeLocalUrl(manualUrlInput);
    if (!normalized) {
      setError('Manual preview URL is invalid. Example: http://127.0.0.1:5173');
      return;
    }
    setError('');
    setManualUrlOverride(normalized);
    setManualUrlInput(normalized);
    setShowManualHint(false);
    queueNotice('Manual URL override set.');
  };

  const clearManualUrl = () => {
    setManualUrlOverride('');
    setManualUrlInput('');
    setManualUrlOpen(false);
    queueNotice('Manual URL override cleared.');
  };

  const injectPicker = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame || !iframeUrl) {
      return { ok: false, reason: 'Start Preview first to enable Design Mode.' };
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
        reason: 'Design Mode is unavailable in this embedded preview origin. Open in Browser and describe changes manually.',
      };
    }
  }, [iframeUrl]);

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
      previewUrl: iframeUrl,
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
      previewUrl: iframeUrl,
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
          <p>Choose a preset (auto-picked), click Start Preview, and focus on the running app.</p>
        </div>
        <div className="preview-v3-meta">
          <span className="pill ui-chip">Project: {activeProject}</span>
          <span className="pill ui-chip">Branch: {activeBranch}</span>
        </div>
      </div>

      <div className="panel-body preview-v3-body">
        {beginnerMode && activeTab === 'preview' && !isRunning && !iframeUrl ? (
          <div className="beginner-empty-card">
            <h4>Start Preview in one click</h4>
            <p>AI Office auto-picks the best preset. Click Start Preview, then wait for your URL.</p>
            <div className="beginner-empty-actions">
              <button type="button" className="ui-btn ui-btn-primary" onClick={startPreview}>
                Start Preview
              </button>
              <button type="button" className="ui-btn" onClick={() => setActiveTab('advanced')}>
                Open Advanced
              </button>
            </div>
          </div>
        ) : null}

        <PreviewTopBar
          statusLabel={statusLabel}
          statusClass={statusClass}
          isRunning={isRunning}
          previewUrl={iframeUrl}
          autoScroll={autoScroll}
          onStart={startPreview}
          onRestart={restartPreview}
          onStop={stopPreview}
          onCopyUrl={copyPreviewUrl}
          onOpenExternal={openExternal}
          onToggleDevicePreset={setDevicePreset}
          devicePreset={devicePreset}
          onToggleAutoScroll={() => setAutoScroll((prev) => !prev)}
          onOpenAdvanced={() => setActiveTab('advanced')}
        />

        <div className="preview-tabs">
          <button
            type="button"
            className={`preview-tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
            onClick={() => setActiveTab('preview')}
          >
            Preview
          </button>
          <button
            type="button"
            className={`preview-tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            Logs
          </button>
          <button
            type="button"
            className={`preview-tab-btn ${activeTab === 'advanced' ? 'active' : ''}`}
            onClick={() => setActiveTab('advanced')}
          >
            Advanced
          </button>
          <button
            type="button"
            className={`preview-tab-btn ${activeTab === 'design' ? 'active' : ''}`}
            onClick={() => setActiveTab('design')}
          >
            Design
          </button>
        </div>

        {activeTab === 'preview' ? (
          <section className="preview-v3-tab-panel preview-main-panel">
            <div className="preview-main-url-note">
              {iframeUrl ? (
                <span>Live URL detected and ready in the embedded frame.</span>
              ) : isRunning ? (
                <span>Waiting for server URL from process metadata or startup logs.</span>
              ) : (
                <span>No preview running. Click Start Preview to launch your app server.</span>
              )}
            </div>

            {isRunning && !iframeUrl && showManualHint ? (
              <div className="preview-manual-url-hint">
                <button type="button" className="ui-btn" onClick={() => setManualUrlOpen((prev) => !prev)}>
                  Can&apos;t detect URL?
                </button>
                {manualUrlOpen ? (
                  <div className="preview-manual-url-editor">
                    <input
                      value={manualUrlInput}
                      onChange={(event) => setManualUrlInput(event.target.value)}
                      placeholder="http://127.0.0.1:5173"
                    />
                    <button type="button" className="ui-btn ui-btn-primary" onClick={applyManualUrl}>
                      Set URL
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {manualUrlOverride ? (
              <div className="preview-manual-url-active">
                <span>Manual URL override is active.</span>
                <button type="button" className="ui-btn" onClick={clearManualUrl}>
                  Clear override
                </button>
              </div>
            ) : null}

            <div className="preview-v3-frame-wrap large">
              <div
                className={`preview-v3-frame-stage preset-${devicePreset}`}
                style={deviceWidth ? { maxWidth: `${deviceWidth}px` } : undefined}
              >
                {iframeUrl ? (
                  <iframe
                    key={`${iframeUrl}-${frameReloadNonce}-${devicePreset}-${activeTab}`}
                    ref={iframeRef}
                    title="Preview"
                    className="preview-v3-iframe"
                    src={iframeUrl}
                  />
                ) : (
                  <div className="preview-v3-empty-state">
                    <strong>No preview running</strong>
                    <span>Click Start Preview to run your app server and see it here.</span>
                    <button type="button" className="ui-btn" onClick={() => setActiveTab('advanced')}>
                      Advanced setup
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === 'logs' ? (
          <LogViewer
            logsSearch={logsSearch}
            onLogsSearchChange={setLogsSearch}
            autoScroll={autoScroll}
            onToggleAutoScroll={() => setAutoScroll((prev) => !prev)}
            paused={logsPaused}
            onTogglePaused={() => setLogsPaused((prev) => !prev)}
            filteredLogs={filteredLogs}
            logsRef={logsRef}
          />
        ) : null}

        {activeTab === 'advanced' ? (
          <section className="preview-v3-tab-panel">
            <SetupAssistant
              loading={assistantLoading}
              stackLabel={assistantStackLabel}
              presets={assistantPresets}
              setupNotes={assistantNotes}
              draftCmd={draftCmd}
              draftPort={draftPort}
              onDraftCmdChange={setDraftCmd}
              onDraftPortChange={setDraftPort}
              processOptions={previewCandidates}
              selectedProcessId={selectedProcess?.id || ''}
              onSelectProcess={setSelectedProcessId}
              onSaveConfig={() => savePreviewConfig().catch((err) => setError(err?.message || 'Failed to save config.'))}
              onUsePreset={applyPreset}
            />
          </section>
        ) : null}

        {activeTab === 'design' ? (
          <section className="preview-v3-tab-panel">
            {!isRunning || !iframeUrl ? (
              <div className="preview-v3-empty-state">
                <strong>Start Preview first to enable Design Mode.</strong>
                <span>Design tools become available after preview is running with a detectable URL.</span>
                <button type="button" className="ui-btn ui-btn-primary" onClick={startPreview}>
                  Start Preview
                </button>
              </div>
            ) : (
              <div className="preview-v3-surface-grid">
                <div className="preview-v3-frame-wrap">
                  <div
                    className={`preview-v3-frame-stage preset-${devicePreset}`}
                    style={deviceWidth ? { maxWidth: `${deviceWidth}px` } : undefined}
                  >
                    <iframe
                      key={`${iframeUrl}-${frameReloadNonce}-${devicePreset}-${activeTab}`}
                      ref={iframeRef}
                      title="Preview Design"
                      className="preview-v3-iframe"
                      src={iframeUrl}
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
                  </div>
                </div>

                <section className="preview-v3-section preview-v3-inspector">
                  <DesignModeToggle
                    enabled={designMode}
                    unavailable={!isRunning || !iframeUrl}
                    onToggle={toggleDesignMode}
                  />
                  <SelectionInspector
                    enabled={designMode}
                    unavailableReason={designUnavailableReason}
                    selection={selection}
                    previewUrl={iframeUrl}
                    requestText={requestText}
                    onRequestTextChange={setRequestText}
                    onDraftRequest={draftEditRequest}
                    onCopyDraft={copyDraftRequest}
                  />
                </section>
              </div>
            )}
          </section>
        ) : null}

        <details className="preview-v3-help">
          <summary>Help: command, port, logs, URL</summary>
          <div>
            <p><strong>Command:</strong> command used to run your app server.</p>
            <p><strong>Port:</strong> local port your app serves on (for example 5173 or 3000).</p>
            <p><strong>Logs:</strong> startup stream for URL hints, errors, and diagnostics.</p>
            <p><strong>URL:</strong> auto-detected from process/logs, with manual override fallback.</p>
          </div>
        </details>

        {error ? <div className="agent-config-error">{error}</div> : null}
        {notice ? <div className="agent-config-notice">{notice}</div> : null}
      </div>
    </div>
  );
}
