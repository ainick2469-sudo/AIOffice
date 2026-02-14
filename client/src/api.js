const BASE = '/api';

export async function fetchAgents() {
  const res = await fetch(`${BASE}/agents`);
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

export async function fetchTasks(status = null) {
  const url = status ? `${BASE}/tasks?status=${status}` : `${BASE}/tasks`;
  const res = await fetch(url);
  return res.json();
}
