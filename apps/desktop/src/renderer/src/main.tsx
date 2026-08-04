import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import { router } from './router';
import { SessionRestorer } from './session-restorer';
import { ThemeSynchronizer } from './theme-synchronizer';
import './styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
});

const root = document.querySelector('#root');
if (!root) throw new Error('Не найден корневой элемент интерфейса.');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionRestorer>
        <ThemeSynchronizer />
        <RouterProvider router={router} />
      </SessionRestorer>
    </QueryClientProvider>
  </StrictMode>,
);
