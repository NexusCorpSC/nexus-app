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
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as authApi from "@/lib/api/auth";
import { ApiError } from "@/lib/api-client";
import { getSessionCookie, setSessionCookie } from "@/lib/settings";
import type { CurrentUser, FeedStatusEvent } from "@/types/nexus";

/**
 * Announces a sign-in or a sign-out, carrying the label of the window it
 * happened in.
 *
 * Each window runs its own copy of this provider, and the overlays are created
 * at startup: without this they would keep the session they saw back then — no
 * session at all — for as long as the app runs, and go on showing the local
 * scratch pad to a signed-in user.
 */
const SESSION_EVENT = "auth://session-changed";

/** Broadcast by Rust whenever the event stream's status changes. */
const FEED_STATUS_EVENT = "feed://status";

/**
 * The one window that acts on the stream being refused.
 *
 * Every window runs this provider, and the stream is refused once for all of
 * them: one has to re-check the session and tell the others, and the main
 * window is the one that always exists — hidden in the tray, perhaps, but
 * there. Without a designated window, the dead cookie would only be cleared
 * by whichever window happened to be looking, or never.
 */
const SESSION_KEEPER_WINDOW = "main";

/**
 * Tells Rust the session on record may have changed, so the event stream it
 * holds to the API follows it: started with a session, stopped without one.
 *
 * Rust reads the session from the same store this side writes, but has no
 * way of knowing when that store has been opened or written — so it is told,
 * by every window after every check. The call is idempotent; seven windows
 * saying the same thing costs nothing.
 */
function syncFeed() {
  void invoke("feed_sync").catch((error) => {
    console.error("cannot sync the event stream with the session", error);
  });
}

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
      syncFeed();
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The session lives in the shared store, so the other windows only need to be
  // told to read it again.
  useEffect(() => {
    const label = getCurrentWindow().label;

    const pending = listen<string>(SESSION_EVENT, (event) => {
      // Our own broadcast: this window already holds the new session, and
      // re-checking it would flash the loading state for nothing.
      if (event.payload === label) return;
      void refresh();
    });

    return () => {
      void pending.then((unlisten) => unlisten());
    };
  }, [refresh]);

  // The stream was refused: the stored session is dead, whatever window is
  // up. Re-checking it clears the cookie (`refresh` does, on a 401), which
  // stops the stream from trying again until someone signs in; the others are
  // told, so none of them goes on showing an account that is no longer there.
  useEffect(() => {
    const label = getCurrentWindow().label;
    if (label !== SESSION_KEEPER_WINDOW) return;

    const pending = listen<FeedStatusEvent>(FEED_STATUS_EVENT, (event) => {
      if (event.payload.status !== "unauthorized") return;

      void refresh().then(() => emit(SESSION_EVENT, label));
    });

    return () => {
      void pending.then((unlisten) => unlisten());
    };
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
      syncFeed();
      await emit(SESSION_EVENT, getCurrentWindow().label);
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    await authApi.signOut();
    setUser(null);
    queryClient.clear();
    syncFeed();
    await emit(SESSION_EVENT, getCurrentWindow().label);
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
