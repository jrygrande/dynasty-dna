import { create } from 'zustand';

interface UIState {
  sidebarOpen: boolean;
  modalOpen: boolean;
  modalContent: React.ReactNode | null;
  notifications: Notification[];
  theme: 'light' | 'dark';

  setSidebarOpen: (open: boolean) => void;
  setModalOpen: (open: boolean) => void;
  setModalContent: (content: React.ReactNode | null) => void;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  setTheme: (theme: 'light' | 'dark') => void;
}

interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  timestamp: Date;
  autoClose?: boolean;
  duration?: number;
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarOpen: false,
  modalOpen: false,
  modalContent: null,
  notifications: [],
  theme: 'light',

  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setModalOpen: (modalOpen) => set({ modalOpen }),
  setModalContent: (modalContent) => set({ modalContent }),
  
  addNotification: (notification) => {
    const id = Date.now().toString();
    const newNotification: Notification = {
      ...notification,
      id,
      timestamp: new Date(),
      autoClose: notification.autoClose ?? true,
      duration: notification.duration ?? 5000,
    };

    set((state) => ({
      notifications: [...state.notifications, newNotification],
    }));

    if (newNotification.autoClose) {
      setTimeout(() => {
        get().removeNotification(id);
      }, newNotification.duration);
    }
  },

  removeNotification: (id) => set((state) => ({
    notifications: state.notifications.filter((n) => n.id !== id),
  })),

  setTheme: (theme) => set({ theme }),
}));