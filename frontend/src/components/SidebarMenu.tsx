import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useSidebarMenuOpen } from '@/contexts/sidebar-menu-context';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { LogOut, Menu, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatSidebarPanel } from '@/components/ChatSidebarPanel';
import { ChatSettingsModal } from '@/components/ChatSettingsModal';
import { sidebarNavButtonClass } from './sidebarStyles';
import { useChatSession } from '@/contexts/chat-session-context';
import { apiFetchJson, queryKeys } from '@/lib/api';
import type { LanguageModel } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { userRoleDisplayName } from '../lib/userRoleDisplay';

const SIDEBAR_WIDTH_STORAGE_KEY = 'sidebarMenuWidthPx';
// Treat iPad landscape (1024px) as "small" so the sidebar overlays content instead of docking.
const SIDEBAR_OVERLAY_BREAKPOINT_PX = 1024;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function readStoredSidebarWidthPx(): number | undefined {
  try {
    const raw = sessionStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

type FooterPageKey =
  | 'chats'
  | 'llm'
  | 'users'
  | 'databases'
  | 'adminClassifiers'
  | 'adminChats'
  | 'adminDataAccess'
  | 'myData';

export function SidebarMenu() {
  const navigate = useNavigate();
  const { logout, userEmail } = useAuth();
  const { t, language } = useTranslation();
  const { open, setOpen } = useSidebarMenuOpen();

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isChatRoute = pathname === '/' || pathname === '';
  const isManagerRoute = pathname === '/manager' || pathname.startsWith('/manager/');
  const isLlmDetailRoute = pathname === '/llm' || pathname.startsWith('/llm/');
  const isUsersRoute = pathname === '/users' || pathname.startsWith('/users/');
  const isDatabasesRoute = pathname === '/databases' || pathname.startsWith('/databases/');
  const isAdminChatsRoute = pathname === '/admin/chats' || pathname.startsWith('/admin/chats/');
  const isAdminClassifiersRoute =
    pathname === '/admin/classifiers' || pathname.startsWith('/admin/classifiers/');
  const isAdminDataAccessRoute =
    pathname === '/admin/data-access' || pathname.startsWith('/admin/data-access/');
  const isMyDataRoute = pathname === '/my-data' || pathname.startsWith('/my-data/');
  const llmMatch = pathname.match(/^\/llm\/(\d+)(?:\/|$)/);
  const activeModelId = llmMatch ? parseInt(llmMatch[1], 10) : undefined;

  const { settingsOpen, setSettingsOpen } = useChatSession();

  const { data: userRoles = [] } = useQuery({
    queryKey: queryKeys.userRoles,
    queryFn: () =>
      apiFetchJson<{ user_role_code: string; user_role_name: string }[]>('/api/user/roles'),
  });

  const { data: userGroups = [] } = useQuery({
    queryKey: queryKeys.userGroups,
    queryFn: () =>
      apiFetchJson<{ user_group_code: string; user_group_name: string }[]>('/api/user/groups'),
  });

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.llms,
    queryFn: () => apiFetchJson<LanguageModel[]>('/api/llms'),
    enabled: open && isLlmDetailRoute,
  });

  const models = [...(data ?? [])].sort((a, b) =>
    (a.llm_name || '').localeCompare(b.llm_name || '')
  );

  const isAdmin = userRoles.some((r) => r.user_role_code === 'ADM');

  const activeFooterPage: FooterPageKey | undefined = (() => {
    if (isChatRoute) return 'chats';
    if (pathname === '/manager' || pathname.startsWith('/manager/')) return 'llm';
    if (pathname === '/llm' || pathname.startsWith('/llm/')) return 'llm';
    if (pathname === '/users' || pathname.startsWith('/users/')) return 'users';
    if (pathname === '/databases' || pathname.startsWith('/databases/')) return 'databases';
    if (isAdminClassifiersRoute) return 'adminClassifiers';
    if (isAdminChatsRoute) return 'adminChats';
    if (isAdminDataAccessRoute) return 'adminDataAccess';
    if (isMyDataRoute) return 'myData';
    return undefined;
  })();

  const adminFooterPages: { key: FooterPageKey; label: string; to: string }[] = [
    { key: 'chats', label: t('sidebar.conversations'), to: '/' },
    { key: 'myData', label: t('sidebar.myAccessibleData'), to: '/my-data' },
    { key: 'adminChats', label: t('sidebar.adminChatDashboard'), to: '/admin/chats' },
    { key: 'adminClassifiers', label: t('sidebar.classifierManagement'), to: '/admin/classifiers' },
    { key: 'llm', label: t('sidebar.languageModels'), to: '/manager' },
    { key: 'users', label: t('sidebar.userManagement'), to: '/users' },
    { key: 'databases', label: t('sidebar.databaseManagement'), to: '/databases' },
    { key: 'adminDataAccess', label: t('sidebar.dataAccessManagement'), to: '/admin/data-access' },
  ];

  const userFooterPages: { key: FooterPageKey; label: string; to: string }[] = [
    { key: 'chats', label: t('sidebar.conversations'), to: '/' },
    { key: 'myData', label: t('sidebar.myAccessibleData'), to: '/my-data' },
  ];

  const footerPages = isAdmin ? adminFooterPages : userFooterPages;

  const getViewportWidth = useCallback(() => {
    if (typeof window === 'undefined') return 1024;
    return window.visualViewport?.width || window.innerWidth || 1024;
  }, []);

  const [viewportWidth, setViewportWidth] = useState<number>(() => getViewportWidth());
  useEffect(() => {
    const onResize = () => setViewportWidth(getViewportWidth());
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, [getViewportWidth]);

  const [isOverlay, setIsOverlay] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(`(max-width: ${SIDEBAR_OVERLAY_BREAKPOINT_PX}px)`).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${SIDEBAR_OVERLAY_BREAKPOINT_PX}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsOverlay(e.matches);
    setIsOverlay(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const minSidebarWidthPx = isOverlay ? Math.min(280, viewportWidth * 0.85) : viewportWidth / 8;
  const maxSidebarWidthPx = isOverlay ? Math.min(420, viewportWidth * 0.92) : viewportWidth / 4;

  // When *transitioning* into overlay mode, force the menu closed so it never "stays open" after a resize.
  // Important: do not continuously close while overlay mode is active, otherwise the user can't open it.
  const prevIsOverlayRef = useRef<boolean>(isOverlay);
  useEffect(() => {
    const prev = prevIsOverlayRef.current;
    prevIsOverlayRef.current = isOverlay;
    if (!prev && isOverlay) setOpen(false);
  }, [isOverlay, setOpen]);

  // In overlay mode, prevent the underlying page from scrolling while the sidebar is open.
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    if (!isOverlay || !open) return;

    // iOS-friendly scroll lock: freeze body at current scroll position.
    const body = document.body;
    const scrollY = window.scrollY;

    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };

    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';

    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, [isOverlay, open]);

  const [sidebarWidthPx, setSidebarWidthPx] = useState<number>(() => {
    const stored = readStoredSidebarWidthPx();
    const fallback = 320;
    const vw = typeof window === 'undefined' ? 1024 : window.innerWidth || 1024;
    return clamp(stored ?? fallback, vw / 8, vw / 4);
  });

  useEffect(() => {
    setSidebarWidthPx((prev) => clamp(prev, minSidebarWidthPx, maxSidebarWidthPx));
  }, [minSidebarWidthPx, maxSidebarWidthPx]);

  useEffect(() => {
    try {
      sessionStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidthPx));
    } catch {
      /* ignore */
    }
  }, [sidebarWidthPx]);

  const dragStateRef = useRef<{
    startX: number;
    startWidth: number;
    dragging: boolean;
  } | null>(null);

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      const state = dragStateRef.current;
      if (!state?.dragging) return;

      const deltaX = e.clientX - state.startX;
      const next = state.startWidth + deltaX;

      setSidebarWidthPx(clamp(next, minSidebarWidthPx, maxSidebarWidthPx));
    },
    [maxSidebarWidthPx, minSidebarWidthPx]
  );

  const onMouseUp = useCallback(() => {
    dragStateRef.current = null;
    window.removeEventListener('mousemove', onMouseMove);
  }, [onMouseMove]);

  const onResizeHandleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragStateRef.current = { startX: e.clientX, startWidth: sidebarWidthPx, dragging: true };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [onMouseMove, onMouseUp, sidebarWidthPx]
  );

  const scrollToSection = useCallback((sectionId: string) => {
    if (typeof document === 'undefined') return;
    const section = document.getElementById(sectionId);
    if (!section) return;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Shared sidebar content used by both overlay (portal) and inline (sticky) renders.
  const sidebarInnerContent = (
    <>
      <div className="shrink-0 border-b border-border">
        <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="h-7 w-7 rounded-[7px] bg-primary text-primary-foreground grid place-items-center text-[12px] font-bold tracking-tight shrink-0"
              aria-hidden="true"
            >
              A
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold leading-tight truncate">
                {t('app.name') ?? 'Assistent'}
              </div>
              <div className="text-[11px] text-muted-foreground leading-tight truncate mt-0.5">
                {t('app.subtitle')}
              </div>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => setOpen(false)}
            title={t('common.closeMenu')}
            className="shrink-0"
          >
            <Menu className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isChatRoute ? (
        <ChatSidebarPanel />
      ) : isManagerRoute ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 p-4 space-y-2 overflow-y-auto min-h-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
              {t('sidebar.languageModels')}
            </p>
            <Button
              variant="outline"
              className={sidebarNavButtonClass}
              onClick={() => scrollToSection('manager-models-section')}
            >
              {t('sidebar.llmModels')}
            </Button>
            <Button
              variant="outline"
              className={sidebarNavButtonClass}
              onClick={() => scrollToSection('manager-data-section')}
            >
              {t('llmData.title')}
            </Button>
            <Button
              variant="outline"
              className={sidebarNavButtonClass}
              onClick={() => scrollToSection('manager-classifiers-section')}
            >
              {t('llmClassifiers.title')}
            </Button>
          </div>
        </div>
      ) : isLlmDetailRoute ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 p-4 space-y-2 overflow-y-auto min-h-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
              {t('sidebar.languageModelsList')}
            </p>
            {isLoading ? (
              <div className="text-[13px] text-muted-foreground">{t('common.loading')}</div>
            ) : models.length === 0 ? (
              <div className="text-[13px] text-muted-foreground">{t('sidebar.noModels')}</div>
            ) : (
              <div className="space-y-1 max-h-[calc(100vh-300px)] overflow-y-auto">
                {models.map((model) => (
                  <button
                    key={model.llm_id}
                    type="button"
                    onClick={() => {
                      if (model.llm_id) {
                        navigate({ to: `/llm/${model.llm_id}` });
                      }
                    }}
                    className={`w-full text-left px-3 py-2 text-[13px] rounded-md transition-colors ${
                      model.llm_id === activeModelId
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent/80'
                    }`}
                  >
                    {model.llm_name || t('sidebar.noName')}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : isUsersRoute ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 p-4 space-y-2 overflow-y-auto min-h-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
              {t('sidebar.userManagement')}
            </p>
            <Button
              variant="outline"
              className={sidebarNavButtonClass}
              onClick={() => scrollToSection('users-management-section')}
            >
              {t('sidebar.userManagement')}
            </Button>
            <Button
              variant="outline"
              className={sidebarNavButtonClass}
              onClick={() => scrollToSection('users-bulk-add-section')}
            >
              {t('users.bulk.title')}
            </Button>
            <Button
              variant="outline"
              className={sidebarNavButtonClass}
              onClick={() => scrollToSection('users-classifiers-section')}
            >
              {t('users.classifiers.title')}
            </Button>
          </div>
        </div>
      ) : isDatabasesRoute ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 p-4 space-y-2 overflow-y-auto min-h-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
              {t('sidebar.databaseManagement')}
            </p>
            <Button
              variant="outline"
              className={sidebarNavButtonClass}
              onClick={() => scrollToSection('databases-management-section')}
            >
              {t('sidebar.databaseManagement')}
            </Button>
            <Button
              variant="outline"
              className={sidebarNavButtonClass}
              onClick={() => scrollToSection('databases-classifiers-section')}
            >
              {t('sidebar.databaseClassifiers')}
            </Button>
          </div>
        </div>
      ) : isAdminChatsRoute ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 p-4 space-y-2 overflow-y-auto min-h-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
              {t('sidebar.adminChatDashboard')}
            </p>
            <Button
              variant="outline"
              className={sidebarNavButtonClass}
              onClick={() => scrollToSection('admin-chats-stats-section')}
            >
              {t('sidebar.adminChatsStats')}
            </Button>
            <Button
              variant="outline"
              className={sidebarNavButtonClass}
              onClick={() => scrollToSection('admin-chats-chats-section')}
            >
              {t('adminChats.chatsTitle')}
            </Button>
            <Button
              variant="outline"
              className={sidebarNavButtonClass}
              onClick={() => scrollToSection('admin-chats-messages-section')}
            >
              {t('adminChats.messagesTitle')}
            </Button>
          </div>
        </div>
      ) : isAdminClassifiersRoute ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 p-4 space-y-2 overflow-y-auto min-h-0">
            <p className="text-sm font-bold text-sidebar-foreground mb-2">
              {t('sidebar.classifierManagement')}
            </p>
            <Button
              variant="outline"
              className={sidebarNavButtonClass}
              onClick={() => scrollToSection('admin-classifiers-dbms-section')}
            >
              {t('databases.classifiers.title')}
            </Button>
            <Button
              variant="outline"
              className={sidebarNavButtonClass}
              onClick={() => scrollToSection('admin-classifiers-user-section')}
            >
              {t('users.classifiers.title')}
            </Button>
            <Button
              variant="outline"
              className={sidebarNavButtonClass}
              onClick={() => scrollToSection('admin-classifiers-llm-section')}
            >
              {t('llmClassifiers.title')}
            </Button>
            <Button
              variant="outline"
              className={sidebarNavButtonClass}
              onClick={() => scrollToSection('admin-classifiers-result-section')}
            >
              {t('adminClassifiers.resultTypesTitle')}
            </Button>
          </div>
        </div>
      ) : isAdminDataAccessRoute ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 p-4 space-y-2 overflow-y-auto min-h-0">
            <p className="text-sm font-bold text-sidebar-foreground mb-2">
              {t('sidebar.dataAccessManagement')}
            </p>
            <Button
              variant="outline"
              className={sidebarNavButtonClass}
              onClick={() => scrollToSection('data-access-resources-bulk-section')}
            >
              {t('sidebar.dataAccessResources')}
            </Button>
            <Button
              variant="outline"
              className={sidebarNavButtonClass}
              onClick={() => scrollToSection('data-access-admin-sql-section')}
            >
              {t('dataAccess.adminSqlSectionNav')}
            </Button>
            <Button
              variant="outline"
              className={sidebarNavButtonClass}
              onClick={() => scrollToSection('data-access-client-sql-section')}
            >
              {t('dataAccess.clientSqlSectionNav')}
            </Button>
            <Button
              variant="outline"
              className={sidebarNavButtonClass}
              onClick={() => scrollToSection('data-access-all-groups-section')}
            >
              {t('dataAccess.allGroupsTitle')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0" />
      )}

      <div className="mt-auto shrink-0 flex flex-col">
        <div className="p-4 space-y-2 border-t border-border">
          {footerPages.map((p) => {
            const isActive = p.key === activeFooterPage;
            return (
              <Button
                key={p.key}
                onClick={() => {
                  if (!isActive) navigate({ to: p.to as any });
                }}
                variant="outline"
                className={`${sidebarNavButtonClass}${isActive ? ' bg-accent text-accent-foreground pointer-events-none' : ''}`}
              >
                {p.label}
              </Button>
            );
          })}
        </div>
        <div className="border-t border-border px-4 py-3 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <p
                className="text-sm font-medium text-sidebar-foreground truncate"
                title={userEmail ?? undefined}
              >
                {userEmail}
              </p>
              {userRoles.length > 0 && (
                <p className="text-xs text-muted-foreground pt-0.5 break-words">
                  {[...userRoles]
                    .sort((a, b) =>
                      userRoleDisplayName(a.user_role_code, a.user_role_name, t).localeCompare(
                        userRoleDisplayName(b.user_role_code, b.user_role_name, t),
                        language === 'et' ? 'et' : 'en',
                        { sensitivity: 'base' }
                      )
                    )
                    .map((r) => userRoleDisplayName(r.user_role_code, r.user_role_name, t))
                    .join(', ')}
                </p>
              )}
              {userGroups.length > 0 && (
                <p className="text-xs text-muted-foreground pt-0.5 break-words">
                  {userGroups.map((g) => g.user_group_name).join(', ')}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-sidebar-foreground"
                title={t('common.settings')}
                aria-label={t('common.settings')}
                onClick={() => setSettingsOpen(true)}
              >
                <Settings className="h-4 w-4 shrink-0" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-sidebar-foreground"
                title={t('common.logOut')}
                aria-label={t('common.logOut')}
                onClick={() => {
                  logout();
                  navigate({ to: '/login' as any });
                }}
              >
                <LogOut className="h-4 w-4 shrink-0" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      {open &&
        isOverlay &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <button
              type="button"
              aria-label={t('common.closeMenu')}
              className="fixed inset-0 z-40 bg-black/40 touch-none"
              onClick={() => setOpen(false)}
            />
            <div
              className="fixed inset-y-0 left-0 z-50 h-[100dvh] bg-sidebar text-sidebar-foreground border-r border-sidebar-border shadow-lg flex flex-col overflow-hidden"
              style={{
                width: sidebarWidthPx,
                minWidth: minSidebarWidthPx,
                maxWidth: maxSidebarWidthPx,
              }}
            >
              {sidebarInnerContent}
            </div>
          </>,
          document.body
        )}

      {open && !isOverlay && (
        <div
          className="flex-shrink-0 h-screen sticky top-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border shadow-sm flex flex-col overflow-hidden"
          style={{
            width: sidebarWidthPx,
            minWidth: minSidebarWidthPx,
            maxWidth: maxSidebarWidthPx,
          }}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={onResizeHandleMouseDown}
            className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none hover:bg-sidebar-accent/60"
            title="Resize"
          />
          {sidebarInnerContent}
        </div>
      )}
      <ChatSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
