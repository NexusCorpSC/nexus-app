import { load, type Store } from "@tauri-apps/plugin-store";

/**
 * Persistent desktop settings, stored by the Tauri `store` plugin in the
 * app data directory (survives restarts).
 */

const STORE_FILE = "settings.json";

const KEY_API_BASE_URL = "apiBaseUrl";
const KEY_SESSION_COOKIE = "sessionCookie";

/**
 * Production Nexus Tools instance.
 *
 * NOTE: the web app references two spellings of the host — `tools.services.nexus`
 * (MCP tool links, better-auth `rpID: "services.nexus"`) and `tools.nexus.services`
 * (page metadata). We default to the former since it matches the auth config,
 * and the URL is overridable from the Settings screen either way.
 */
export const DEFAULT_API_BASE_URL = "https://tools.services.nexus";

/** Hosts allowed by the `http` capability in `src-tauri/capabilities/default.json`. */
export const ALLOWED_API_BASE_URLS = [
  "https://tools.services.nexus",
  "https://tools.nexus.services",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load(STORE_FILE, { autoSave: true });
  }
  return storePromise;
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export async function getApiBaseUrl(): Promise<string> {
  const store = await getStore();
  const value = await store.get<string>(KEY_API_BASE_URL);
  return value ? normalizeBaseUrl(value) : DEFAULT_API_BASE_URL;
}

export async function setApiBaseUrl(url: string): Promise<void> {
  const store = await getStore();
  await store.set(KEY_API_BASE_URL, normalizeBaseUrl(url));
}

/**
 * The raw `Cookie` header value replayed on authenticated requests.
 * Captured from `Set-Cookie` when signing in, so we never have to guess
 * better-auth's cookie name (it is prefixed with `__Secure-` over HTTPS).
 */
export async function getSessionCookie(): Promise<string | null> {
  const store = await getStore();
  return (await store.get<string>(KEY_SESSION_COOKIE)) ?? null;
}

export async function setSessionCookie(cookie: string | null): Promise<void> {
  const store = await getStore();
  if (cookie) {
    await store.set(KEY_SESSION_COOKIE, cookie);
  } else {
    await store.delete(KEY_SESSION_COOKIE);
  }
}
