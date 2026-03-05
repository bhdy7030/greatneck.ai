/**
 * Auth helpers — token + user storage in localStorage.
 */

const TOKEN_KEY = "gn_token";
const USER_KEY = "gn_user";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  avatar_url: string;
  is_admin: boolean;
  can_debug: boolean;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setStoredUser(user: AuthUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearStoredUser(): void {
  localStorage.removeItem(USER_KEY);
}

export function clearAuth(): void {
  clearToken();
  clearStoredUser();
}
