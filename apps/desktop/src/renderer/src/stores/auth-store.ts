import {
  t,
  type AuthenticatedUser,
  type ForcedPasswordChangeInput,
  type LoginCredentials,
  type PasswordChangeInput,
} from '@arava/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { getDesktopApi } from '../lib/desktop-api';

interface AuthState {
  changePassword: (input: PasswordChangeInput) => Promise<void>;
  completePasswordChange: (input: ForcedPasswordChangeInput) => Promise<void>;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
  sessionMessage: string | null;
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
      completePasswordChange: async (input) => {
        const token = get().token;
        if (!token) throw new Error(t('domain.authentication.required'));
        const session = await getDesktopApi().auth.completePasswordChange(token, input);
        set({ token: session.token, user: session.user });
      },
      login: async (credentials) => {
        const session = await getDesktopApi().auth.login(credentials);
        set({ sessionMessage: null, status: 'ready', token: session.token, user: session.user });
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
      sessionMessage: null,
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

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (
      typeof event.data === 'object' &&
      event.data !== null &&
      'type' in event.data &&
      event.data.type === 'arava-session-expired'
    ) {
      useAuthStore.setState({
        sessionMessage: t('domain.authentication.sessionExpired'),
        status: 'ready',
        token: null,
        user: null,
      });
    }
  });
}

export function getSessionToken(): string {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error(t('domain.authentication.required'));
  return token;
}
