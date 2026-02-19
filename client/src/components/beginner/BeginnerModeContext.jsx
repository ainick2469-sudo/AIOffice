/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const BEGINNER_MODE_KEY = 'ai-office:beginner-mode-enabled';
const BEGINNER_PROGRESS_KEY = 'ai-office:beginner-progress-v1';

const BeginnerModeContext = createContext(null);

function normalizeProjectName(projectName) {
  const value = String(projectName || 'ai-office').trim().toLowerCase();
  return value || 'ai-office';
}

function createProgressRecord() {
  return {
    viewsOpened: {},
    discussMessageCount: 0,
    spec: {
      length: 0,
      completeness: 0,
      approved: false,
    },
    preview: {
      running: false,
      url: '',
    },
    updatedAt: null,
  };
}

function readBooleanStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw !== 'false';
  } catch {
    return fallback;
  }
}

function normalizeProgressRecord(raw) {
  const base = createProgressRecord();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    viewsOpened: raw.viewsOpened && typeof raw.viewsOpened === 'object' ? raw.viewsOpened : {},
    discussMessageCount: Number(raw.discussMessageCount) || 0,
    spec: {
      ...base.spec,
      ...(raw.spec && typeof raw.spec === 'object' ? raw.spec : {}),
      length: Number(raw?.spec?.length) || 0,
      completeness: Number(raw?.spec?.completeness) || 0,
      approved: Boolean(raw?.spec?.approved),
    },
    preview: {
      ...base.preview,
      ...(raw.preview && typeof raw.preview === 'object' ? raw.preview : {}),
      running: Boolean(raw?.preview?.running),
      url: String(raw?.preview?.url || ''),
    },
  };
}

function readProgressMap() {
  try {
    const raw = localStorage.getItem(BEGINNER_PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const normalized = {};
    Object.keys(parsed).forEach((key) => {
      normalized[normalizeProjectName(key)] = normalizeProgressRecord(parsed[key]);
    });
    return normalized;
  } catch {
    return {};
  }
}

function writeProgressMap(progressMap) {
  try {
    localStorage.setItem(BEGINNER_PROGRESS_KEY, JSON.stringify(progressMap || {}));
  } catch {
    // ignore storage failures
  }
}

export function BeginnerModeProvider({ children }) {
  const [enabled, setEnabled] = useState(() => readBooleanStorage(BEGINNER_MODE_KEY, true));
  const [progressMap, setProgressMap] = useState(() => readProgressMap());

  const setBeginnerEnabled = useCallback((nextValue) => {
    const normalized = Boolean(nextValue);
    setEnabled(normalized);
    try {
      localStorage.setItem(BEGINNER_MODE_KEY, normalized ? 'true' : 'false');
    } catch {
      // ignore storage failures
    }
  }, []);

  const toggleEnabled = useCallback(() => {
    setBeginnerEnabled(!enabled);
  }, [enabled, setBeginnerEnabled]);

  const updateProjectProgress = useCallback((projectName, updater) => {
    const key = normalizeProjectName(projectName);
    setProgressMap((prev) => {
      const current = normalizeProgressRecord(prev[key]);
      const next = normalizeProgressRecord(
        typeof updater === 'function'
          ? updater(current)
          : { ...current, ...(updater || {}) }
      );
      next.updatedAt = new Date().toISOString();
      const merged = { ...prev, [key]: next };
      writeProgressMap(merged);
      return merged;
    });
  }, []);

  const markViewOpened = useCallback((projectName, viewId) => {
    const view = String(viewId || '').trim().toLowerCase();
    if (!view) return;
    updateProjectProgress(projectName, (prev) => ({
      ...prev,
      viewsOpened: {
        ...(prev.viewsOpened || {}),
        [view]: true,
      },
    }));
  }, [updateProjectProgress]);

  const setDiscussMessageCount = useCallback((projectName, count) => {
    const safeCount = Math.max(0, Number(count) || 0);
    updateProjectProgress(projectName, (prev) => ({
      ...prev,
      discussMessageCount: safeCount,
    }));
  }, [updateProjectProgress]);

  const setSpecMetrics = useCallback((projectName, metrics) => {
    updateProjectProgress(projectName, (prev) => ({
      ...prev,
      spec: {
        ...(prev.spec || {}),
        length: Math.max(0, Number(metrics?.length) || 0),
        completeness: Math.max(0, Math.min(100, Number(metrics?.completeness) || 0)),
        approved: Boolean(metrics?.approved),
      },
    }));
  }, [updateProjectProgress]);

  const setPreviewState = useCallback((projectName, preview) => {
    updateProjectProgress(projectName, (prev) => ({
      ...prev,
      preview: {
        ...(prev.preview || {}),
        running: Boolean(preview?.running),
        url: String(preview?.url || '').trim(),
      },
    }));
  }, [updateProjectProgress]);

  const getProjectProgress = useCallback((projectName) => {
    const key = normalizeProjectName(projectName);
    return normalizeProgressRecord(progressMap[key]);
  }, [progressMap]);

  const resetProjectProgress = useCallback((projectName) => {
    const key = normalizeProjectName(projectName);
    setProgressMap((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      writeProgressMap(next);
      return next;
    });
  }, []);

  const resetAllProgress = useCallback(() => {
    setProgressMap({});
    writeProgressMap({});
  }, []);

  const value = useMemo(() => ({
    enabled,
    setEnabled: setBeginnerEnabled,
    toggleEnabled,
    getProjectProgress,
    markViewOpened,
    setDiscussMessageCount,
    setSpecMetrics,
    setPreviewState,
    resetProjectProgress,
    resetAllProgress,
  }), [
    enabled,
    setBeginnerEnabled,
    toggleEnabled,
    getProjectProgress,
    markViewOpened,
    setDiscussMessageCount,
    setSpecMetrics,
    setPreviewState,
    resetProjectProgress,
    resetAllProgress,
  ]);

  return (
    <BeginnerModeContext.Provider value={value}>
      {children}
    </BeginnerModeContext.Provider>
  );
}

export function useBeginnerMode() {
  const value = useContext(BeginnerModeContext);
  if (!value) {
    throw new Error('useBeginnerMode must be used inside BeginnerModeProvider');
  }
  return value;
}
