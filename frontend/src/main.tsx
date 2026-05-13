import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './contexts/AuthProvider';
import { LanguageProvider } from './contexts/LanguageProvider';
import { ThemeProvider } from './contexts/ThemeProvider';
import { ModalProvider } from './contexts/modal-context';
import { Toaster } from 'react-hot-toast';

import { routeTree } from './routeTree.gen';

const router = createRouter({
  routeTree,
  basepath: '/',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient();

const rootElement = document.getElementById('root')!;
if (!rootElement.innerHTML) {
  const root = createRoot(rootElement);
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <ThemeProvider>
            <ModalProvider>
              <AuthProvider>
                <RouterProvider router={router} />
                <Toaster
                  toastOptions={{
                    style: {
                      background: 'var(--popover)',
                      color: 'var(--popover-foreground)',
                      border: '1px solid var(--border)',
                    },
                  }}
                />
              </AuthProvider>
            </ModalProvider>
          </ThemeProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}
