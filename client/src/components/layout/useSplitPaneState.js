import { useMemo, useState } from 'react';

const DEFAULT_LAYOUT_BY_MODE = {
  split: { ratio: 0.58, collapsed: { chat: false, preview: false } },
  'full-ide': { leftRatio: 0.24, centerRatio: 0.62, collapsed: { chat: false, preview: false } },
  'focus-chat': { collapsed: { chat: false, preview: true } },
  'focus-preview': { collapsed: { chat: true, preview: false } },
  'focus-files': { collapsed: { chat: true, preview: true } },
};

function normalizeMode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'focus') return 'focus-preview';
  if (DEFAULT_LAYOUT_BY_MODE[raw]) return raw;
  return 'split';
}

function modeStorageKey(projectName, branch) {
  const project = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  const safeBranch = String(branch || 'main').trim() || 'main';
  return `ai-office:workspace-layout-mode:${project}:${safeBranch}`;
}

function layoutStorageKey(projectName, branch, mode) {
  const project = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  const safeBranch = String(branch || 'main').trim() || 'main';
  const safeMode = normalizeMode(mode);
  return `ai-office:workspace-layout-state:${project}:${safeBranch}:${safeMode}`;
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore write failures
  }
}

function mergeLayout(mode, ...sources) {
  const base = DEFAULT_LAYOUT_BY_MODE[mode] || DEFAULT_LAYOUT_BY_MODE.split;
  const merged = {
    ...base,
    collapsed: { ...(base.collapsed || {}) },
  };
  sources.forEach((source) => {
    if (!source || typeof source !== 'object') return;
    Object.entries(source).forEach(([key, value]) => {
      if (key === 'collapsed' && value && typeof value === 'object') {
        merged.collapsed = { ...(merged.collapsed || {}), ...value };
      } else {
        merged[key] = value;
      }
    });
  });
  return merged;
}

export default function useSplitPaneState({
  projectName,
  branch,
  initialMode = 'split',
}) {
  const branchName = branch || 'main';
  const scopeModeKey = useMemo(() => modeStorageKey(projectName, branchName), [projectName, branchName]);

  const [modeOverrides, setModeOverrides] = useState({});
  const [layoutOverrides, setLayoutOverrides] = useState({});

  const persistedMode = readJson(scopeModeKey)?.value;
  const fallbackMode = normalizeMode(initialMode);
  const mode = normalizeMode(modeOverrides[scopeModeKey] || persistedMode || fallbackMode);

  const setMode = (nextMode) => {
    const normalized = normalizeMode(nextMode);
    setModeOverrides((prev) => ({ ...prev, [scopeModeKey]: normalized }));
    writeJson(scopeModeKey, { value: normalized, updated_at: new Date().toISOString() });
  };

  const scopeLayoutKey = useMemo(
    () => layoutStorageKey(projectName, branchName, mode),
    [projectName, branchName, mode]
  );
  const persistedLayout = readJson(scopeLayoutKey);
  const layout = mergeLayout(mode, persistedLayout, layoutOverrides[scopeLayoutKey]);

  const updateLayout = (partial) => {
    if (!partial || typeof partial !== 'object') return;
    setLayoutOverrides((prev) => {
      const current = mergeLayout(mode, persistedLayout, prev[scopeLayoutKey]);
      const next = mergeLayout(mode, current, partial);
      writeJson(scopeLayoutKey, next);
      return { ...prev, [scopeLayoutKey]: next };
    });
  };

  const resetLayout = () => {
    const defaults = mergeLayout(mode, null);
    try {
      localStorage.removeItem(scopeLayoutKey);
    } catch {
      // ignore storage failures
    }
    setLayoutOverrides((prev) => ({ ...prev, [scopeLayoutKey]: defaults }));
  };

  return {
    mode,
    setMode,
    layout,
    updateLayout,
    resetLayout,
  };
}
