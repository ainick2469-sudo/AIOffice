function chatDraftKey({ project = 'ai-office', channel = 'main', mode = 'build' } = {}) {
  const safeProject = String(project || 'ai-office').trim().toLowerCase() || 'ai-office';
  const safeChannel = String(channel || 'main').trim().toLowerCase() || 'main';
  const safeMode = String(mode || 'build').trim().toLowerCase() || 'build';
  return `ai-office:chat-draft:${safeProject}:${safeChannel}:${safeMode}`;
}

function normalizeContext(item) {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id || '').trim();
  const type = String(item.type || 'context').trim();
  const label = String(item.label || '').trim();
  const value = String(item.value || '').trim();
  if (!id || !label) return null;
  return { id, type, label, value };
}

export function loadChatDraft(scope) {
  try {
    const raw = localStorage.getItem(chatDraftKey(scope));
    if (!raw) return { text: '', contexts: [] };
    const parsed = JSON.parse(raw);
    const text = String(parsed?.text || '');
    const contexts = Array.isArray(parsed?.contexts)
      ? parsed.contexts.map(normalizeContext).filter(Boolean)
      : [];
    return { text, contexts };
  } catch {
    return { text: '', contexts: [] };
  }
}

export function saveChatDraft(scope, payload = {}) {
  const text = String(payload?.text || '');
  const contexts = Array.isArray(payload?.contexts)
    ? payload.contexts.map(normalizeContext).filter(Boolean)
    : [];
  const next = {
    text,
    contexts,
    saved_at: new Date().toISOString(),
  };
  try {
    localStorage.setItem(chatDraftKey(scope), JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
  return next;
}

export function clearChatDraft(scope) {
  try {
    localStorage.removeItem(chatDraftKey(scope));
  } catch {
    // ignore storage failures
  }
}
