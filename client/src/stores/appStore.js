import { create } from 'zustand';

export const useAppStore = create((set) => ({
  // Toast notifications
  toasts: [],
  addToast: (message, type = 'info', duration = 5000) => {
    const id = Date.now() + Math.random(); // prevent collision when called in tight loops
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, duration);
  },

  // Global loading state
  loading: false,
  setLoading: (loading) => set({ loading }),

  // Recording mode: 'mic' = mic only, 'mix' = mic + desktop audio
  recordingMode: 'mix',
  setRecordingMode: (mode) => set({ recordingMode: mode }),

  // Selected microphone device
  selectedMicId: '', // '' = system default
  setSelectedMicId: (id) => set({ selectedMicId: id }),

  // Subscription tier
  tier: 'ownkey',
  tierInfo: null,
  setTierInfo: (info) => set({
    tier: info?.tier || 'ownkey',
    tierInfo: info,
    processingMode: info?.processingMode || 'ownkey',
  }),

  // Processing mode: 'offline' | 'ownkey' | 'managed'
  processingMode: 'ownkey',
  setProcessingMode: (mode) => set({ processingMode: mode }),

  // Highlights & memos during current recording session
  highlights: [],
  addHighlight: (timestamp, label = '') => set((s) => ({
    highlights: [...s.highlights, { timestamp, label }],
  })),
  clearHighlights: () => set({ highlights: [] }),

  // In-flight infographic generations, keyed by recordingId.
  // Value is a count of pending generations on that recording. The gallery
  // uses this to show "生成中..." placeholder cards, and the dashboard uses
  // it to show a pulsing badge.
  pendingInfographics: {}, // { [recordingId]: { count, startedAt } }
  startInfographicGeneration: (recordingId) => set((s) => {
    const cur = s.pendingInfographics[recordingId] || { count: 0, startedAt: null };
    return {
      pendingInfographics: {
        ...s.pendingInfographics,
        [recordingId]: { count: cur.count + 1, startedAt: cur.startedAt || Date.now() },
      },
    };
  }),
  endInfographicGeneration: (recordingId) => set((s) => {
    const cur = s.pendingInfographics[recordingId];
    if (!cur) return s;
    const nextCount = Math.max(0, cur.count - 1);
    const next = { ...s.pendingInfographics };
    if (nextCount === 0) {
      delete next[recordingId];
    } else {
      next[recordingId] = { ...cur, count: nextCount };
    }
    return { pendingInfographics: next };
  }),
}));
