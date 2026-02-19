const CREATION_DRAFT_KEY = 'aiOffice.creationDraft';

function sanitizeImportEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return {
    path: entry.path || '',
    name: entry.file?.name || entry.name || '',
    size: Number(entry.file?.size || entry.size || 0),
    type: entry.file?.type || entry.type || '',
    hasFile: Boolean(entry.file),
  };
}

function sanitizeImportItem(item) {
  if (!item || typeof item !== 'object') return null;
  const entries = Array.isArray(item.entries) ? item.entries.map(sanitizeImportEntry).filter(Boolean) : [];
  return {
    id: item.id || '',
    kind: item.kind || 'files',
    name: item.name || '',
    count: Number(item.count || entries.length || 0),
    bytes: Number(item.bytes || 0),
    summary: item.summary || '',
    entries,
    missingFiles: entries.some((entry) => !entry.hasFile),
  };
}

export function buildCreationDraft(payload = {}) {
  const nowIso = new Date().toISOString();
  const text = String(payload.text ?? payload.prompt ?? '');
  const importQueueRuntime = Array.isArray(payload.importQueueRuntime)
    ? payload.importQueueRuntime
    : (Array.isArray(payload.queued_imports) ? payload.queued_imports : []);

  const importQueue = Array.isArray(payload.importQueue)
    ? payload.importQueue
    : importQueueRuntime.map(sanitizeImportItem).filter(Boolean);

  return {
    id: payload.id || `draft-${Date.now()}`,
    text,
    createdAt: payload.createdAt || nowIso,
    updatedAt: nowIso,
    templateId: payload.templateId || payload.template || null,
    importQueue,
    importQueueRuntime,
    suggestedName: payload.suggestedName || payload.project_name || '',
    suggestedStack: payload.suggestedStack || payload.stack_choice || 'auto-detect',
    discussionSeeded: Boolean(payload.discussionSeeded),
    summary: {
      goals: payload.summary?.goals || '',
      risks: payload.summary?.risks || '',
      questions: payload.summary?.questions || '',
      nextSteps: payload.summary?.nextSteps || '',
    },
  };
}

export function toStorageDraft(draft) {
  const next = buildCreationDraft(draft);
  return {
    id: next.id,
    text: next.text,
    createdAt: next.createdAt,
    updatedAt: next.updatedAt,
    templateId: next.templateId,
    importQueue: next.importQueue,
    suggestedName: next.suggestedName,
    suggestedStack: next.suggestedStack,
    discussionSeeded: Boolean(next.discussionSeeded),
    summary: next.summary,
  };
}

export function saveCreationDraft(draft) {
  const storageDraft = toStorageDraft(draft);
  try {
    localStorage.setItem(CREATION_DRAFT_KEY, JSON.stringify(storageDraft));
  } catch {
    // ignore storage failures
  }
  return storageDraft;
}

export function loadCreationDraft() {
  try {
    const raw = localStorage.getItem(CREATION_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return buildCreationDraft({
      ...parsed,
      importQueueRuntime: [],
    });
  } catch {
    return null;
  }
}

export function clearCreationDraft() {
  try {
    localStorage.removeItem(CREATION_DRAFT_KEY);
  } catch {
    // ignore storage failures
  }
}
