import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, type PropsWithChildren } from 'react';

import { useAuthStore } from './stores/auth-store';

export function SessionRestorer({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const restore = useAuthStore((state) => state.restore);
  const token = useAuthStore((state) => state.token);
  const previousToken = useRef(token);
  useEffect(() => {
    void restore();
  }, [restore]);
  useEffect(() => {
    if (previousToken.current !== token) queryClient.clear();
    previousToken.current = token;
  }, [queryClient, token]);
  return children;
}
