import { create } from 'zustand';

export const useAppStore = create((set) => ({
  // Toast notifications
  toasts: [],
  addToast: (message, type = 'info') => {
    const id = Date.now();
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 5000);
  },

  // Global loading state
  loading: false,
  setLoading: (loading) => set({ loading }),
}));
