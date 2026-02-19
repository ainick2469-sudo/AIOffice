const BASE = '/api';

export async function fetchAgents(activeOnly = true) {
  const res = await fetch(`${BASE}/agents?active_only=${activeOnly ? 'true' : 'false'}`);
  return res.json();
}

export async function fetchChannels() {
  const res = await fetch(`${BASE}/channels`);
  return res.json();
}

export async function fetchMessages(channel, limit = 50) {
  const res = await fetch(`${BASE}/messages/${channel}?limit=${limit}`);
  return res.json();
}

export async function fetchTasks(filters = {}) {
  const params = new URLSearchParams();
  const status = filters?.status ?? null;
  const channel = filters?.channel ?? null;
  const projectName = filters?.project_name ?? null;
  const branch = filters?.branch ?? null;

  if (status) params.set('status', status);
  if (channel) params.set('channel', channel);
  if (projectName) params.set('project_name', projectName);
  if (branch) params.set('branch', branch);

  const qs = params.toString();
  const url = qs ? `${BASE}/tasks?${qs}` : `${BASE}/tasks`;
  const res = await fetch(url);
  return res.json();
}

export async function updateAgent(agentId, updates) {
  const res = await fetch(`${BASE}/agents/${agentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.detail || 'Failed to update agent');
  }
  return data;
}

export async function startAppBuilder(payload) {
  const res = await fetch(`${BASE}/app-builder/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.detail || 'Failed to start app builder');
  }
  return data;
}

export async function fetchOllamaRecommendations() {
  const res = await fetch(`${BASE}/ollama/models/recommendations`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.detail || 'Failed to load Ollama model recommendations');
  }
  return data;
}

export async function pullOllamaModels(payload = {}) {
  const res = await fetch(`${BASE}/ollama/models/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.detail || 'Failed to pull Ollama models');
  }
  return data;
}
