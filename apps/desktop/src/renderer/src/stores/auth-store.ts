import type { AuthenticatedUser, LoginCredentials } from '@arava/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface AuthState {
  login: (credentials: LoginCredentials) => void;
  logout: () => void;
  user: AuthenticatedUser | null;
}

function nameFromEmail(email: string): string {
  const localPart = email.split('@')[0] ?? 'User';
  return localPart
    .split(/[._-]/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      login: ({ email }) => {
        set({ user: { email, name: nameFromEmail(email) } });
      },
      logout: () => {
        set({ user: null });
      },
      user: null,
    }),
    {
      name: 'arava-auth',
      partialize: (state) => ({ user: state.user }),
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
