import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

const SIDEBAR_OPEN_STORAGE_KEY = 'sidebarMenuOpen';

function readStoredSidebarOpen(): boolean {
  try {
    const v = sessionStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch {
    /* ignore */
  }
  return true;
}

type SidebarMenuOpenContextValue = {
  open: boolean;
  setOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
};

const SidebarMenuOpenContext = createContext<SidebarMenuOpenContextValue | null>(null);

export function SidebarMenuOpenProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState<boolean>(readStoredSidebarOpen);

  const setOpen = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setOpenState((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      try {
        sessionStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(resolved));
      } catch {
        /* ignore */
      }
      return resolved;
    });
  }, []);

  const value = useMemo(() => ({ open, setOpen }), [open, setOpen]);

  return (
    <SidebarMenuOpenContext.Provider value={value}>{children}</SidebarMenuOpenContext.Provider>
  );
}

export function useSidebarMenuOpen(): SidebarMenuOpenContextValue {
  const ctx = useContext(SidebarMenuOpenContext);
  if (!ctx) {
    throw new Error('useSidebarMenuOpen must be used within SidebarMenuOpenProvider');
  }
  return ctx;
}
