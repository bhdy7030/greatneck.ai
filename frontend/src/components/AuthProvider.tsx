"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  getToken,
  setToken,
  setRefreshToken,
  clearAuth,
  getStoredUser,
  setStoredUser,
  type AuthUser,
} from "@/lib/auth";
import {
  fetchCurrentUser,
  logoutServer,
  getUsageInfo,
  type UsageInfo,
  type TierFeatures,
} from "@/lib/api";

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: () => void;
  logout: () => void;
  tier: string;
  features: TierFeatures | null;
  usage: UsageInfo | null;
  refreshUsage: () => Promise<void>;
}

const DEFAULT_FEATURES: TierFeatures = {
  web_search_mode: "limited",
  fast_mode_forced: true,
  deep_mode_allowed: false,
  max_queries: 20,
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  login: () => {},
  logout: () => {},
  tier: "anonymous",
  features: DEFAULT_FEATURES,
  usage: null,
  refreshUsage: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [usage, setUsage] = useState<UsageInfo | null>(null);

  const refreshUsage = useCallback(async () => {
    try {
      const info = await getUsageInfo();
      setUsage(info);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    // Check URL for ?token= and ?refresh= from OAuth callback
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get("token");
    const refreshParam = params.get("refresh");
    if (tokenParam) {
      setToken(tokenParam);
      params.delete("token");
    }
    if (refreshParam) {
      setRefreshToken(refreshParam);
      params.delete("refresh");
    }
    if (tokenParam || refreshParam) {
      const qs = params.toString();
      const newUrl =
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
      window.history.replaceState({}, "", newUrl);
    }

    // Try to load user
    const token = getToken();
    if (!token) {
      setIsLoading(false);
      refreshUsage(); // Get anonymous usage
      return;
    }

    // Try cached user first for instant UI, then validate with server
    const cached = getStoredUser();
    if (cached) {
      setUser(cached);
    }

    fetchCurrentUser()
      .then((u) => {
        setUser(u);
        setStoredUser(u);
      })
      .catch(() => {
        clearAuth();
        setUser(null);
      })
      .finally(() => {
        setIsLoading(false);
        refreshUsage();
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(() => {
    const returnTo = window.location.pathname + window.location.search;
    window.location.href = `${BASE_URL}/api/auth/google?return_to=${encodeURIComponent(returnTo)}`;
  }, []);

  const logout = useCallback(async () => {
    await logoutServer();
    setUser(null);
    setUsage(null);
    refreshUsage();
  }, [refreshUsage]);

  const tier = usage?.tier ?? (user ? "free" : "anonymous");
  const features = usage?.features ?? DEFAULT_FEATURES;

  return (
    <AuthContext.Provider
      value={{ user, isLoading, login, logout, tier, features, usage, refreshUsage }}
    >
      {children}
    </AuthContext.Provider>
  );
}
