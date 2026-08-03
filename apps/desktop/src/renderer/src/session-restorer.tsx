import { useEffect, type PropsWithChildren } from 'react';

import { useAuthStore } from './stores/auth-store';

export function SessionRestorer({ children }: PropsWithChildren) {
  const restore = useAuthStore((state) => state.restore);
  useEffect(() => {
    void restore();
  }, [restore]);
  return children;
}
