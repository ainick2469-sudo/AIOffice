import { useRef, useState } from 'react';

function isZip(file) {
  const name = String(file?.name || '').toLowerCase();
  return name.endsWith('.zip');
}

const PHASES = [
  { id: 'uploading', label: 'Uploading' },
  { id: 'extracting', label: 'Extracting' },
  { id: 'detecting', label: 'Detecting stack' },
  { id: 'seeding', label: 'Seeding tasks/spec' },
];

export default function ImportDropzone({ onImported, onPhaseChange }) {
  const zipInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const setPhaseWithNotify = (nextPhase) => {
    setPhase(nextPhase);
    onPhaseChange?.(nextPhase);
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const upload = async (formData) => {
    setBusy(true);
    setError('');
    setPhaseWithNotify('uploading');
    setStatus('Uploading files...');
    try {
      const resp = await fetch('/api/projects/import', {
        method: 'POST',
        body: formData,
      });
      const payload = resp.ok ? await resp.json() : null;
      if (!resp.ok) {
        throw new Error(payload?.detail || payload?.error || 'Import failed.');
      }
      setPhaseWithNotify('extracting');
      setStatus('Extracting files...');
      await wait(150);
      setPhaseWithNotify('detecting');
      setStatus('Detecting stack...');
      await wait(150);
      setPhaseWithNotify('seeding');
      setStatus('Seeding tasks and spec...');
      await wait(150);
      setStatus(`Imported ${payload.project} (${payload.extracted_files || 0} files).`);
      setPhaseWithNotify('');
      onImported?.(payload);
    } catch (err) {
      setError(err?.message || 'Import failed.');
      setPhaseWithNotify('');
    } finally {
      setBusy(false);
    }
  };

  const onZipFilePicked = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('zip_file', file, file.name);
    await upload(form);
    event.target.value = '';
  };

  const onFolderPicked = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    const form = new FormData();
    files.forEach((file) => {
      const rel = file.webkitRelativePath || file.name;
      form.append('files', file, rel);
    });
    await upload(form);
    event.target.value = '';
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    setDragActive(false);
    if (busy) return;

    const files = Array.from(event.dataTransfer.files || []);
    if (files.length === 0) return;

    const zip = files.find(isZip);
    if (zip) {
      const form = new FormData();
      form.append('zip_file', zip, zip.name);
      await upload(form);
      return;
    }

    const form = new FormData();
    files.forEach((file) => form.append('files', file, file.webkitRelativePath || file.name));
    await upload(form);
  };

  return (
    <div
      className={`import-dropzone ${dragActive ? 'active' : ''} ${busy ? 'busy' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!busy) setDragActive(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setDragActive(false);
      }}
      onDrop={handleDrop}
    >
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        onChange={onZipFilePicked}
        className="hidden-file-input"
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        webkitdirectory="true"
        directory="true"
        onChange={onFolderPicked}
        className="hidden-file-input"
      />

      <h4>Import / Drop files to create a project</h4>
      <p>Drop a zip or project folder to deconstruct, understand, and rebuild.</p>
      {busy && (
        <div className="import-phase-list">
          {PHASES.map((item) => (
            <div key={item.id} className={`import-phase-item ${phase === item.id ? 'active' : ''}`}>
              <span className="import-phase-dot" />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      )}
      <div className="import-dropzone-actions">
        <button className="refresh-btn" disabled={busy} onClick={() => zipInputRef.current?.click()}>
          Upload Zip
        </button>
        <button className="refresh-btn" disabled={busy} onClick={() => folderInputRef.current?.click()}>
          Upload Folder
        </button>
      </div>
      {status && <div className="agent-config-notice">{status}</div>}
      {error && <div className="agent-config-error">{error}</div>}
    </div>
  );
}
