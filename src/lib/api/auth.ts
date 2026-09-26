import { invoke } from "@tauri-apps/api/core";
import { apiRequest } from "@/lib/api-client";
import { getApiBaseUrl, setSessionCookie } from "@/lib/settings";
import type { CurrentUser } from "@/types/nexus";

/**
 * Sign-in happens on Nexus Tools, in the browser.
 *
 * The site's `/desktop/connect` page signs the user in if they are not already
 * — by whatever means the site offers — then sends the browser back to a
 * loopback port the app listens on (`src-tauri/src/browser_auth.rs`), with a
 * one-time code. The code is traded here for a session of the app's own.
 *
 * The code alone is not enough: the app sends the site the hash of a secret it
 * keeps, and hands over the secret with the code (PKCE, RFC 7636). The `state`
 * tells this attempt's answer from any other.
 */

/** What Rust hands back once the browser has returned. */
type BrowserCallback = { code: string; state: string };

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

export async function signInWithBrowser(): Promise<CurrentUser> {
  const state = randomToken();
  const verifier = randomToken();

  const url = new URL("/desktop/connect", `${await getApiBaseUrl()}/`);
  url.searchParams.set("state", state);
  url.searchParams.set("challenge", await challengeOf(verifier));

  const callback = await invoke<BrowserCallback>("browser_sign_in", {
    url: url.toString(),
  });

  if (callback.state !== state) {
    throw new Error(
      "La réponse du navigateur ne correspond pas à cette connexion.",
    );
  }

  await apiRequest<unknown>("/api/auth/desktop/exchange", {
    method: "POST",
    body: { code: callback.code, verifier },
    authenticated: false,
    // Persists the returned session cookie for subsequent requests.
    captureCookies: true,
  });

  return getCurrentUser();
}

/** Ends the attempt under way: the browser was closed, or the user gave up. */
export function cancelBrowserSignIn(): Promise<void> {
  return invoke("cancel_browser_sign_in");
}

export function getCurrentUser() {
  return apiRequest<CurrentUser>("/api/me");
}

export async function signOut() {
  try {
    await apiRequest<unknown>("/api/auth/sign-out", { method: "POST" });
  } catch {
    // The local session is cleared regardless of what the server answers.
  }
  await setSessionCookie(null);
}
