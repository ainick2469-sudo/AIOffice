const CREATION_DRAFT_KEY = 'aiOffice.creationDraft';
const CREATION_DRAFT_KEY_PREFIX = 'aiOffice.creationDraft:';
const CREATION_DRAFT_CURRENT_ID_KEY = 'aiOffice.creationDraft.currentId';
const PIPELINE_STEPS = new Set(['describe', 'discuss', 'plan', 'build']);
const PHASE_STATES = new Set(['DISCUSS', 'SPEC', 'READY_TO_BUILD', 'BUILDING']);

function toPhaseFromPipeline(step) {
  const value = String(step || '').trim().toLowerCase();
  if (value === 'build') return 'BUILDING';
  if (value === 'plan') return 'SPEC';
  return 'DISCUSS';
}

function toPipelineFromPhase(phase) {
  const value = String(phase || '').trim().toUpperCase();
  if (value === 'BUILDING') return 'build';
  if (value === 'SPEC' || value === 'READY_TO_BUILD') return 'plan';
  return 'discuss';
}

function safeDraftId(input) {
  const raw = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  return raw || `draft-${Date.now()}`;
}

function storageKeyForDraft(draftId) {
  return `${CREATION_DRAFT_KEY_PREFIX}${safeDraftId(draftId)}`;
}

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

  const requestedPhase = String(payload.phase || '').trim().toUpperCase();
  const normalizedPhase = PHASE_STATES.has(requestedPhase) ? requestedPhase : toPhaseFromPipeline(payload.pipelineStep);
  const requestedStep = String(payload.pipelineStep || '').trim().toLowerCase();
  const pipelineFromPhase = toPipelineFromPhase(normalizedPhase);
  const pipelineStep = PIPELINE_STEPS.has(requestedStep)
    ? requestedStep
    : (text ? pipelineFromPhase : 'describe');
  const draftId = safeDraftId(payload.draftId || payload.id);
  const seedPrompt = String(payload.seedPrompt ?? payload.rawRequest ?? text);
  const phase = PIPELINE_STEPS.has(requestedStep) && !payload.phase
    ? toPhaseFromPipeline(requestedStep)
    : normalizedPhase;

  return {
    id: draftId,
    draftId,
    text,
    seedPrompt,
    createdAt: payload.createdAt || nowIso,
    lastEditedAt: payload.lastEditedAt || payload.updatedAt || nowIso,
    updatedAt: nowIso,
    pipelineStep,
    phase,
    templateId: payload.templateId || payload.template || null,
    templateHint: payload.templateHint || payload.templateId || payload.template || null,
    importQueue,
    importQueueRuntime,
    attachments: importQueue,
    suggestedName: payload.suggestedName || payload.project_name || '',
    projectName: payload.projectName || payload.suggestedName || payload.project_name || '',
    suggestedStack: payload.suggestedStack || payload.stack_choice || 'auto-detect',
    stackHint: payload.stackHint || payload.suggestedStack || payload.stack_choice || 'auto-detect',
    discussionSeeded: Boolean(payload.discussionSeeded),
    specDraftMd: String(payload.specDraftMd || payload.spec_md || ''),
    specDraft: String(payload.specDraft || payload.specDraftMd || payload.spec_md || ''),
    ideaBankMd: String(payload.ideaBankMd || payload.idea_bank_md || ''),
    rawRequest: seedPrompt,
    brainstormMessages: Array.isArray(payload.brainstormMessages)
      ? payload.brainstormMessages.filter((item) => item && typeof item === 'object')
      : [],
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
    draftId: next.draftId,
    text: next.text,
    seedPrompt: next.seedPrompt,
    createdAt: next.createdAt,
    lastEditedAt: next.lastEditedAt,
    updatedAt: next.updatedAt,
    pipelineStep: next.pipelineStep,
    phase: next.phase,
    templateId: next.templateId,
    templateHint: next.templateHint,
    importQueue: next.importQueue,
    attachments: next.attachments,
    suggestedName: next.suggestedName,
    projectName: next.projectName,
    suggestedStack: next.suggestedStack,
    stackHint: next.stackHint,
    discussionSeeded: Boolean(next.discussionSeeded),
    specDraftMd: next.specDraftMd,
    specDraft: next.specDraft,
    ideaBankMd: next.ideaBankMd,
    rawRequest: next.rawRequest,
    brainstormMessages: next.brainstormMessages,
    summary: next.summary,
  };
}

export function saveCreationDraft(draft) {
  const storageDraft = toStorageDraft(draft);
  const key = storageKeyForDraft(storageDraft.draftId || storageDraft.id);
  try {
    localStorage.setItem(key, JSON.stringify(storageDraft));
    localStorage.setItem(CREATION_DRAFT_CURRENT_ID_KEY, storageDraft.draftId || storageDraft.id);
    localStorage.setItem(CREATION_DRAFT_KEY, JSON.stringify(storageDraft));
  } catch {
    // ignore storage failures
  }
  return storageDraft;
}

export function loadCreationDraft(draftId = null) {
  const requestedId = String(draftId || '').trim();
  try {
    let raw = null;
    if (requestedId) {
      raw = localStorage.getItem(storageKeyForDraft(requestedId));
    } else {
      const currentId = localStorage.getItem(CREATION_DRAFT_CURRENT_ID_KEY);
      if (currentId) {
        raw = localStorage.getItem(storageKeyForDraft(currentId));
      }
      if (!raw) {
        raw = localStorage.getItem(CREATION_DRAFT_KEY);
      }
    }
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
  const current = loadCreationDraft();
  const key = storageKeyForDraft(current?.draftId || current?.id || '');
  try {
    if (current?.draftId || current?.id) {
      localStorage.removeItem(key);
    }
    localStorage.removeItem(CREATION_DRAFT_CURRENT_ID_KEY);
    localStorage.removeItem(CREATION_DRAFT_KEY);
  } catch {
    // ignore storage failures
  }
}

export function clearCreationDraftById(draftId) {
  const safe = safeDraftId(draftId);
  try {
    localStorage.removeItem(storageKeyForDraft(safe));
    const currentId = localStorage.getItem(CREATION_DRAFT_CURRENT_ID_KEY);
    if (currentId && safeDraftId(currentId) === safe) {
      localStorage.removeItem(CREATION_DRAFT_CURRENT_ID_KEY);
      localStorage.removeItem(CREATION_DRAFT_KEY);
    }
  } catch {
    // ignore storage failures
  }
}

export function listCreationDrafts() {
  const rows = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(CREATION_DRAFT_KEY_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') continue;
      rows.push(buildCreationDraft({ ...parsed, importQueueRuntime: [] }));
    }
  } catch {
    // ignore parse/storage failures
  }
  return rows.sort((a, b) => {
    const aTime = new Date(a?.updatedAt || a?.lastEditedAt || 0).getTime() || 0;
    const bTime = new Date(b?.updatedAt || b?.lastEditedAt || 0).getTime() || 0;
    return bTime - aTime;
  });
}
