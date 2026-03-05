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
  clearAuth,
  getStoredUser,
  setStoredUser,
  type AuthUser,
} from "@/lib/auth";
import { fetchCurrentUser } from "@/lib/api";

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  login: () => {},
  logout: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check URL for ?token= from OAuth callback
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get("token");
    if (tokenParam) {
      setToken(tokenParam);
      // Strip token from URL
      params.delete("token");
      const qs = params.toString();
      const newUrl =
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
      window.history.replaceState({}, "", newUrl);
    }

    // Try to load user
    const token = getToken();
    if (!token) {
      setIsLoading(false);
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
        // Token invalid — clear
        clearAuth();
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(() => {
    const returnTo = window.location.pathname + window.location.search;
    window.location.href = `${BASE_URL}/api/auth/google?return_to=${encodeURIComponent(returnTo)}`;
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
