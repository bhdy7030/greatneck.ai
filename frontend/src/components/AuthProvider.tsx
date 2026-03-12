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
  getInviteCode,
  getSessionId,
  clearInviteCode,
  type AuthUser,
} from "@/lib/auth";
import {
  fetchCurrentUser,
  logoutServer,
  getUsageInfo,
  linkInviteToAccount,
  type UsageInfo,
  type TierFeatures,
} from "@/lib/api";
import HandlePicker from "@/components/HandlePicker";

/** Detect in-app browsers (Facebook, Instagram, WeChat, LINE, etc.) where Google blocks OAuth. */
function isInAppBrowser(): boolean {
  const ua = navigator.userAgent || "";
  return /FBAN|FBAV|Instagram|Line|WeChat|MicroMessenger|Twitter|Snapchat|Pinterest/i.test(ua);
}

function isWeChat(): boolean {
  return /MicroMessenger|WeChat/i.test(navigator.userAgent || "");
}

function InAppBrowserPrompt({ onClose }: { onClose: () => void }) {
  const wechat = isWeChat();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-3xl mb-3">{wechat ? "🔗" : "🌐"}</div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          {wechat ? "请在浏览器中打开" : "Open in Browser to Sign In"}
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          {wechat
            ? "微信内无法登录，请点击右上角 ··· 选择「在浏览器打开」"
            : "Sign-in is not supported in this browser. Please open this page in Safari or Chrome."}
        </p>
        <div className="bg-gray-50 rounded-xl p-3 mb-4 text-left text-sm text-gray-700">
          {wechat ? (
            <ol className="list-decimal list-inside space-y-1">
              <li>点击右上角 <span className="font-bold">···</span></li>
              <li>选择 <span className="font-bold">&quot;在浏览器打开&quot;</span></li>
              <li>然后点击登录</li>
            </ol>
          ) : (
            <ol className="list-decimal list-inside space-y-1">
              <li>Tap the <span className="font-bold">···</span> or share button</li>
              <li>Choose <span className="font-bold">&quot;Open in Safari&quot;</span> or <span className="font-bold">&quot;Open in Browser&quot;</span></li>
              <li>Then sign in</li>
            </ol>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium text-gray-700 transition-colors"
        >
          {wechat ? "知道了" : "Got it"}
        </button>
      </div>
    </div>
  );
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: () => void;
  loginWithApple: () => void;
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
  loginWithApple: () => {},
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
  const [showBrowserPrompt, setShowBrowserPrompt] = useState(false);
  const [showHandlePicker, setShowHandlePicker] = useState(false);

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
      .then(async (u) => {
        setUser(u);
        setStoredUser(u);
        // Show handle picker if user has no handle
        if (!u.handle) {
          setShowHandlePicker(true);
        }
        // After login, link any stored invite code to this account
        const inviteCode = getInviteCode();
        if (inviteCode && !u.is_invited) {
          try {
            await linkInviteToAccount(getSessionId());
            clearInviteCode();
            // Refresh user to get updated is_invited
            const updated = await fetchCurrentUser();
            setUser(updated);
            setStoredUser(updated);
          } catch {
            // non-critical
          }
        }
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
    // Google blocks OAuth in in-app browsers (Facebook, Instagram, WeChat, etc.)
    if (isInAppBrowser()) {
      setShowBrowserPrompt(true);
      return;
    }
    // Strip ?invite= from returnTo — it's already stored in localStorage
    const params = new URLSearchParams(window.location.search);
    params.delete("invite");
    const qs = params.toString();
    const returnTo = window.location.pathname + (qs ? `?${qs}` : "");
    window.location.href = `${BASE_URL}/api/auth/google?return_to=${encodeURIComponent(returnTo)}`;
  }, []);

  const loginWithApple = useCallback(() => {
    if (isInAppBrowser()) {
      setShowBrowserPrompt(true);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    params.delete("invite");
    const qs = params.toString();
    const returnTo = window.location.pathname + (qs ? `?${qs}` : "");
    window.location.href = `${BASE_URL}/api/auth/apple?return_to=${encodeURIComponent(returnTo)}`;
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
      value={{ user, isLoading, login, loginWithApple, logout, tier, features, usage, refreshUsage }}
    >
      {children}
      {showBrowserPrompt && (
        <InAppBrowserPrompt onClose={() => setShowBrowserPrompt(false)} />
      )}
      {showHandlePicker && user && (
        <HandlePicker
          userName={user.name}
          onComplete={(handle) => {
            setShowHandlePicker(false);
            setUser({ ...user, handle });
            setStoredUser({ ...user, handle });
          }}
        />
      )}
    </AuthContext.Provider>
  );
}
