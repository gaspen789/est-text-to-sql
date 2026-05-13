import { createRootRoute, Outlet, redirect, useRouterState } from '@tanstack/react-router';
import { LanguageSelector } from '@/components/LanguageSelector';
import { ScrollToTopButton } from '@/components/ScrollToTopButton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SidebarMenu } from '@/components/SidebarMenu';
import { ChatSessionProvider } from '@/contexts/chat-session-context';
import { SidebarMenuOpenProvider } from '@/contexts/sidebar-menu-context';

function isPublicAuthPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.endsWith('/login') ||
    pathname === '/reset-password' ||
    pathname.endsWith('/reset-password')
  );
}

function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (isPublicAuthPath(pathname)) {
    return (
      <>
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
          <ThemeToggle />
          <LanguageSelector />
        </div>
        <Outlet />
        <ScrollToTopButton />
      </>
    );
  }

  return (
    <>
      <ChatSessionProvider>
        <SidebarMenuOpenProvider>
          <div className="flex h-svh min-h-0 w-full overflow-hidden">
            <SidebarMenu />
            <div
              id="app-main-column"
              className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            >
              <Outlet />
            </div>
          </div>
        </SidebarMenuOpenProvider>
      </ChatSessionProvider>
      <ScrollToTopButton />
    </>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
  beforeLoad: ({ location }) => {
    // Normalize trailing slashes to avoid file-route "Not Found" on refresh or external links.
    if (location.pathname.length > 1 && location.pathname.endsWith('/')) {
      const trimmed = location.pathname.replace(/\/+$/, '');
      throw redirect({ to: (trimmed || '/') as any });
    }

    const isAuthenticated = sessionStorage.getItem('isAuthenticated') === 'true';
    const isPublic = isPublicAuthPath(location.pathname);
    const isLoginPage = location.pathname === '/login' || location.pathname.endsWith('/login');

    if (!isAuthenticated && !isPublic) {
      throw redirect({
        to: '/login' as any,
      });
    }

    // Authenticated users hitting /login go home; /reset-password is always accessible
    // so a logged-in user can still complete a reset link they opened on this device.
    if (isAuthenticated && isLoginPage) {
      throw redirect({
        to: '/' as any,
      });
    }
  },
});
