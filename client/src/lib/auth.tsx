import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import { clearSensitiveCache } from './offline';

export interface User {
  id: number;
  username: string;
  fullName: string;
  role: string;
  roleName: string;
  maxDiscountPercent: number;
  permissions: string[];
}

interface AuthState {
  user: User | null;
  loading: boolean;
  /** true when /auth/me could not be reached (offline), not when signed out */
  unreachable: boolean;
  login: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (...perms: string[]) => boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const CACHE_KEY = 'yash.lastUser';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ user: User }>('/auth/me');
      setUser(r.user);
      setUnreachable(false);
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(r.user)); } catch { /* ignore */ }
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        // offline: keep working with the identity from this browser session only
        setUnreachable(true);
        try { const c = sessionStorage.getItem(CACHE_KEY); if (c) setUser(JSON.parse(c)); } catch { /* ignore */ }
      } else setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onUnauth = () => setUser(null);
    window.addEventListener('yash:unauthenticated', onUnauth);
    return () => window.removeEventListener('yash:unauthenticated', onUnauth);
  }, [refresh]);

  const login = async (username: string, password: string) => {
    const r = await api.post<{ user: User }>('/auth/login', { username, password });
    setUser(r.user);
    setUnreachable(false);
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(r.user)); } catch { /* ignore */ }
  };

  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    try { sessionStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
    await clearSensitiveCache();
    setUser(null);
  };

  const can = useCallback((...perms: string[]) => !!user && perms.some((p) => user.permissions.includes(p)), [user]);

  return <Ctx.Provider value={{ user, loading, unreachable, login, logout, can, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
