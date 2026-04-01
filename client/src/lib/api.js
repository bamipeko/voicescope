const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'リクエストに失敗しました');
  }
  return res.json();
}

// Recordings
export const getRecordings = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/recordings${qs ? `?${qs}` : ''}`);
};

export const getRecording = (id) => request(`/recordings/${id}`);

export const uploadRecording = async (file, title) => {
  const form = new FormData();
  form.append('audio', file);
  if (title) form.append('title', title);
  const res = await fetch(`${BASE}/recordings/upload`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'アップロードに失敗しました');
  }
  return res.json();
};

export const updateRecording = (id, data) =>
  request(`/recordings/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteRecording = (id) =>
  request(`/recordings/${id}`, { method: 'DELETE' });

export const transcribeRecording = (id, options = {}) =>
  request(`/recordings/${id}/transcribe`, { method: 'POST', body: JSON.stringify(options) });

export const summarizeRecording = (id, options = {}) =>
  request(`/recordings/${id}/summarize`, { method: 'POST', body: JSON.stringify(options) });

export const deleteSummary = (id) =>
  request(`/recordings/summaries/${id}`, { method: 'DELETE' });

export const updateTranscription = (id, data) =>
  request(`/recordings/transcriptions/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

// Templates
export const getTemplates = () => request('/templates');
export const createTemplate = (data) =>
  request('/templates', { method: 'POST', body: JSON.stringify(data) });
export const updateTemplate = (id, data) =>
  request(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteTemplate = (id) =>
  request(`/templates/${id}`, { method: 'DELETE' });
export const testTemplate = (id, data) =>
  request(`/templates/${id}/test`, { method: 'POST', body: JSON.stringify(data) });

// Tags
export const getTags = () => request('/tags');
export const addTag = (recordingId, data) =>
  request(`/recordings/${recordingId}/tags`, { method: 'POST', body: JSON.stringify(data) });
export const removeTag = (recordingId, tagId) =>
  request(`/recordings/${recordingId}/tags/${tagId}`, { method: 'DELETE' });

// Settings
export const getSettings = () => request('/settings');
export const updateSettings = (data) =>
  request('/settings', { method: 'PATCH', body: JSON.stringify(data) });

// Audio URL
export const getAudioUrl = (id) => `${BASE}/recordings/${id}/audio`;
