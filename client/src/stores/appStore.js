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
}));
