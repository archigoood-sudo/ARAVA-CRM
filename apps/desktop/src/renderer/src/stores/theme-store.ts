import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemeMode = 'dark' | 'light' | 'system';

interface ThemeState {
  setTheme: (theme: ThemeMode) => void;
  theme: ThemeMode;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      setTheme: (theme) => {
        set({ theme });
      },
      theme: 'system',
    }),
    {
      name: 'arava-theme',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
