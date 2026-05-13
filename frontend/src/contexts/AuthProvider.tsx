import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { AuthContext } from './auth-context';
import { LanguageContext } from './language-context';
import toast from '@/lib/toast';
import { apiGet } from '@/lib/api';

export function AuthProvider({ children }: { children: ReactNode }) {
  const lang = useContext(LanguageContext);

  // Initialize authentication state from sessionStorage
  // This persists during page refreshes but clears when window is closed
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('isAuthenticated') === 'true';
    }
    return false;
  });
  const [userEmail, setUserEmail] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('userEmail');
    }
    return null;
  });

  useEffect(() => {
    // Sync authentication state to sessionStorage
    // This persists during page refreshes but clears when window is closed
    if (isAuthenticated) {
      sessionStorage.setItem('isAuthenticated', 'true');
      if (userEmail) {
        sessionStorage.setItem('userEmail', userEmail);
      }
    } else {
      sessionStorage.removeItem('isAuthenticated');
      sessionStorage.removeItem('userEmail');
    }
  }, [isAuthenticated, userEmail]);

  const login = (email: string) => {
    setIsAuthenticated(true);
    setUserEmail(email);
  };

  const logout = () => {
    setIsAuthenticated(false);
    setUserEmail(null);
    // Clear userId from sessionStorage
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('userId');
    }
  };

  const deactivatedMessage = useMemo(() => {
    const t = lang?.t;
    if (!t) {
      return 'Your account has been deactivated. If this is a mistake, please contact an administrator.';
    }
    return t('auth.accountDeactivated');
  }, [lang]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let handled = false;
    const onDeactivated = () => {
      if (handled) return;
      handled = true;

      // Persist across the forced full-page redirect below so the user still sees it.
      try {
        sessionStorage.setItem('authDeactivated', '1');
      } catch {
        /* ignore */
      }

      // Best-effort: show it immediately too (may disappear due to full reload).
      toast.error(deactivatedMessage);
      logout();

      // Ensure we leave protected routes immediately.
      window.location.href = `/login`;
    };

    window.addEventListener('auth:deactivated', onDeactivated as EventListener);
    return () => window.removeEventListener('auth:deactivated', onDeactivated as EventListener);
  }, [deactivatedMessage]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (typeof window === 'undefined') return;

    let cancelled = false;

    const check = async () => {
      try {
        const res = await apiGet('/api/user/session-status');
        if (!res.ok) return; // api wrapper dispatches deactivation event if needed
        await res.json().catch(() => null);
      } catch {
        // Ignore transient network errors; next tick will retry.
      }
    };

    // Immediate check + periodic polling for near-real-time deactivation.
    void check();
    const id = window.setInterval(() => {
      if (!cancelled) void check();
    }, 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isAuthenticated]);

  return (
    <AuthContext.Provider value={{ isAuthenticated, userEmail, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
