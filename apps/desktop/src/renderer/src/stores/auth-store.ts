import {
  t,
  type AuthenticatedUser,
  type LoginCredentials,
  type PasswordChangeInput,
} from '@arava/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { getDesktopApi } from '../lib/desktop-api';

interface AuthState {
  changePassword: (input: PasswordChangeInput) => Promise<void>;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
  status: 'ready' | 'restoring';
  token: string | null;
  user: AuthenticatedUser | null;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      changePassword: async (input) => {
        const token = get().token;
        if (!token) throw new Error(t('domain.authentication.required'));
        const user = await getDesktopApi().auth.changePassword(token, input);
        set({ user });
      },
      login: async (credentials) => {
        const session = await getDesktopApi().auth.login(credentials);
        set({ status: 'ready', token: session.token, user: session.user });
      },
      logout: async () => {
        const token = get().token;
        set({ status: 'ready', token: null, user: null });
        if (token)
          await getDesktopApi()
            .auth.logout(token)
            .catch(() => undefined);
      },
      restore: async () => {
        const token = get().token;
        if (!token) {
          set({ status: 'ready', user: null });
          return;
        }
        set({ status: 'restoring' });
        try {
          const user = await getDesktopApi().auth.restore(token);
          set({ status: 'ready', user });
        } catch {
          set({ status: 'ready', token: null, user: null });
        }
      },
      status: 'restoring',
      token: null,
      user: null,
    }),
    {
      name: 'arava-auth',
      partialize: (state) => ({ token: state.token, user: state.user }),
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export function getSessionToken(): string {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error(t('domain.authentication.required'));
  return token;
}
