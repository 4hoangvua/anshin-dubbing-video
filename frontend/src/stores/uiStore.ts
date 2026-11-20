import { create } from 'zustand';
import type { ThemeMode, ToastMessage, BannerNotice } from '../types';

interface UIState {
  theme: ThemeMode;
  sidebarCollapsed: boolean;
  inspectorCollapsed: boolean;
  activeModal: 'modelHub' | 'settings' | 'shortcuts' | null;
  toasts: ToastMessage[];
  banner: BannerNotice | null;

  // Actions
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setInspectorCollapsed: (collapsed: boolean) => void;
  toggleInspector: () => void;
  openModal: (modal: 'modelHub' | 'settings' | 'shortcuts') => void;
  closeModal: () => void;
  addToast: (toast: Omit<ToastMessage, 'id'>) => string;
  removeToast: (id: string) => void;
  setBanner: (banner: BannerNotice | null) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: 'dark',
  sidebarCollapsed: false,
  inspectorCollapsed: false,
  activeModal: null,
  toasts: [],
  banner: null,

  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },

  toggleTheme: () => {
    const nextTheme = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(nextTheme);
  },

  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setInspectorCollapsed: (inspectorCollapsed) => set({ inspectorCollapsed }),
  toggleInspector: () => set((state) => ({ inspectorCollapsed: !state.inspectorCollapsed })),

  openModal: (activeModal) => set({ activeModal }),
  closeModal: () => set({ activeModal: null }),

  addToast: (toast) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newToast: ToastMessage = { ...toast, id };

    set((state) => ({ toasts: [...state.toasts, newToast] }));

    const duration = toast.durationMs ?? 4000;
    if (duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, duration);
    }
    return id;
  },

  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  setBanner: (banner) => set({ banner }),
}));
