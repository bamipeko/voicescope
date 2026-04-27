const BASE = '/api';

// Cached API token (loaded once from Electron, empty in browser/Docker mode)
let _tokenPromise = null;
let _resolvedToken = '';

function getApiToken() {
  if (_tokenPromise) return _tokenPromise;
  _tokenPromise = (async () => {
    try {
      if (window.electronAPI?.getApiToken) {
        const token = await window.electronAPI.getApiToken();
        _resolvedToken = token || '';
        return _resolvedToken;
      }
    } catch (e) {
      // Not in Electron or IPC failed — no token needed (dev/Docker mode)
    }
    return '';
  })();
  return _tokenPromise;
}

// Reset token cache so next request re-fetches (used on 401 retry)
function resetToken() {
  _tokenPromise = null;
  _resolvedToken = '';
}

async function request(path, options = {}, _retry = 0) {
  const token = await getApiToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['x-api-token'] = token;
  const res = await fetch(`${BASE}${path}`, {
    headers,
    ...options,
  });
  if (!res.ok) {
    // On 401, reset token and retry once (covers startup race condition)
    if (res.status === 401 && _retry === 0) {
      resetToken();
      await new Promise(r => setTimeout(r, 300));
      return request(path, options, 1);
    }
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

const appendUploadOptions = (form, options) => {
  if (options.auto_summarize !== undefined) form.append('auto_summarize', String(options.auto_summarize));
  if (options.template_id) form.append('template_id', options.template_id);
  if (options.granularity) form.append('granularity', options.granularity);
  if (options.provider) form.append('provider', options.provider);
  if (options.model) form.append('model', options.model);
};

export const uploadText = async (file, title, options = {}) => {
  const token = await getApiToken();
  const form = new FormData();
  form.append('textfile', file);
  if (title) form.append('title', title);
  appendUploadOptions(form, options);
  const headers = {};
  if (token) headers['x-api-token'] = token;
  const res = await fetch(`${BASE}/recordings/upload-text`, { method: 'POST', body: form, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'テキストアップロードに失敗しました');
  }
  return res.json();
};

export const uploadRecording = async (file, title, highlights = [], options = {}) => {
  const token = await getApiToken();
  const form = new FormData();
  form.append('audio', file);
  if (title) form.append('title', title);
  if (highlights.length > 0) form.append('highlights', JSON.stringify(highlights));
  appendUploadOptions(form, options);
  const headers = {};
  if (token) headers['x-api-token'] = token;
  const res = await fetch(`${BASE}/recordings/upload`, { method: 'POST', body: form, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'アップロードに失敗しました');
  }
  return res.json();
};

export const updateRecording = (id, data) =>
  request(`/recordings/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

// DELETE without ?permanent moves the recording to trash (soft delete).
// Pass { permanent: true } to fully remove it (used from Trash view only).
export const deleteRecording = (id, options = {}) => {
  const qs = options.permanent ? '?permanent=1' : '';
  return request(`/recordings/${id}${qs}`, { method: 'DELETE' });
};

// Soft-state transitions — used by Dashboard / Archive / Trash views
export const archiveRecording = (id) =>
  request(`/recordings/${id}/archive`, { method: 'POST' });
export const trashRecording = (id) =>
  request(`/recordings/${id}/trash`, { method: 'POST' });
export const restoreRecording = (id) =>
  request(`/recordings/${id}/restore`, { method: 'POST' });
export const emptyTrash = () =>
  request('/recordings/trash/empty', { method: 'POST' });

// Counts for sidebar badges (active / archived / trashed)
export const getRecordingCounts = () => request('/recordings/counts');

// Open the OS file manager at the recording's audio file (target='audio')
// or the data directory (target='data_dir'). Only works in Electron/Standalone.
export const revealRecording = (id, target = 'audio') =>
  request(`/recordings/${id}/reveal`, { method: 'POST', body: JSON.stringify({ target }) });

export const transcribeRecording = (id, options = {}) =>
  request(`/recordings/${id}/transcribe`, { method: 'POST', body: JSON.stringify(options) });

export const summarizeRecording = (id, options = {}) =>
  request(`/recordings/${id}/summarize`, { method: 'POST', body: JSON.stringify(options) });

export const reprocessRecording = (id) =>
  request(`/recordings/${id}/reprocess`, { method: 'POST' });

export const refineRecording = (id) =>
  request(`/recordings/${id}/refine`, { method: 'POST' });

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
export const reorderTemplates = (order) =>
  request('/templates/reorder', { method: 'POST', body: JSON.stringify({ order }) });

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
export const updateApiKeys = (keys) =>
  request('/settings/api-keys', { method: 'POST', body: JSON.stringify(keys) });

// Local services
export const getLocalStatus = (refresh) =>
  request(`/local-status${refresh ? '?refresh=1' : ''}`);
export const getDownloadStatus = () =>
  request('/local-status/downloads');
export const setupWhisperCpp = () =>
  request('/local-status/whisper-cpp/setup', { method: 'POST' });
export const downloadWhisperModel = (model) =>
  request('/local-status/whisper-cpp/download-model', { method: 'POST', body: JSON.stringify({ model }) });
export const pullOllamaModel = (model) =>
  request('/local-status/ollama/pull', { method: 'POST', body: JSON.stringify({ model }) });

// Folders
export const getFolders = () => request('/folders');
export const createFolder = (data) =>
  request('/folders', { method: 'POST', body: JSON.stringify(data) });
export const updateFolder = (id, data) =>
  request(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteFolder = (id) =>
  request(`/folders/${id}`, { method: 'DELETE' });
export const addRecordingToFolder = (folderId, recordingId) =>
  request(`/folders/${folderId}/recordings/${recordingId}`, { method: 'POST' });
export const removeRecordingFromFolder = (folderId, recordingId) =>
  request(`/folders/${folderId}/recordings/${recordingId}`, { method: 'DELETE' });

// Ask AI about a recording
export const askRecording = (id, question, history = [], options = {}) =>
  request(`/recordings/${id}/ask`, { method: 'POST', body: JSON.stringify({ question, history, ...options }) });

export const getChatHistory = (id) => request(`/recordings/${id}/chat`);
export const clearChatHistory = (id) => request(`/recordings/${id}/chat`, { method: 'DELETE' });

// Storage management
export const getStorageStats = () => request('/recordings/storage');
export const bulkDeleteRecordings = (options) =>
  request('/recordings/bulk', { method: 'DELETE', body: JSON.stringify(options) });

// Tier / subscription
export const getTierInfo = () => request('/settings/tier');
export const activateTrial = (code) =>
  request('/settings/activate-trial', { method: 'POST', body: JSON.stringify({ code }) });

// Processing mode (offline / ownkey / managed)
export const setProcessingMode = (mode) =>
  request('/settings', { method: 'PATCH', body: JSON.stringify({ processing_mode: mode }) });

// Custom OpenAI-compatible endpoint (LM Studio / llama.cpp etc.)
export const testCustomEndpoint = (url) =>
  request('/settings/test-custom-endpoint', { method: 'POST', body: JSON.stringify({ url }) });

// Cross-recording ask
export const askCross = (question, scope = {}, history = [], options = {}) =>
  request('/ask-cross', { method: 'POST', body: JSON.stringify({ question, scope, history, ...options }) });
// Note: options can include { provider, model, sessionId, includeLocal }
export const getCrossSessions = () => request('/ask-cross/sessions');
export const getCrossChat = (sessionId) => request(`/ask-cross/chat?sessionId=${sessionId}`);
export const clearCrossChat = (sessionId) => request(`/ask-cross/chat?sessionId=${sessionId}`, { method: 'DELETE' });

// Known speakers (autocomplete)
export const getKnownSpeakers = () => request('/recordings/known-speakers');

// Audio URL (token passed as query param since this is used in <audio src>)
export const getAudioUrl = (id) => {
  // Use cached resolved token (already loaded by prior API calls)
  const tokenParam = _resolvedToken ? `?token=${_resolvedToken}` : '';
  return `${BASE}/recordings/${id}/audio${tokenParam}`;
};
