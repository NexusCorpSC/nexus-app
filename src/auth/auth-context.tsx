import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as authApi from "@/lib/api/auth";
import { ApiError } from "@/lib/api-client";
import { getSessionCookie, setSessionCookie } from "@/lib/settings";
import type { CurrentUser } from "@/types/nexus";

type AuthState = {
  user: CurrentUser | null;
  /** True until the persisted session has been checked on startup. */
  loading: boolean;
  sendOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, otp: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-checks the stored session, e.g. after the API URL changed. */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const cookie = await getSessionCookie();
      if (!cookie) {
        setUser(null);
        return;
      }
      setUser(await authApi.getCurrentUser());
    } catch (error) {
      // A rejected or expired session should not keep a dead cookie around.
      if (error instanceof ApiError && error.isUnauthorized) {
        await setSessionCookie(null);
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sendOtp = useCallback(async (email: string) => {
    await authApi.sendSignInOtp(email);
  }, []);

  const verifyOtp = useCallback(
    async (email: string, otp: string) => {
      const signedIn = await authApi.verifySignInOtp(email, otp);
      setUser(signedIn);
      // Authenticated endpoints answered 401 while signed out; drop those.
      await queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    await authApi.signOut();
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthState>(
    () => ({ user, loading, sendOtp, verifyOtp, signOut, refresh }),
    [user, loading, sendOtp, verifyOtp, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an <AuthProvider>");
  }
  return context;
}
