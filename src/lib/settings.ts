import { load, type Store } from "@tauri-apps/plugin-store";

/**
 * Persistent desktop settings, stored by the Tauri `store` plugin in the
 * app data directory (survives restarts).
 */

const STORE_FILE = "settings.json";

const KEY_API_BASE_URL = "apiBaseUrl";
const KEY_SESSION_COOKIE = "sessionCookie";
const KEY_SHORTCUT_SEARCH = "shortcutSearch";
const KEY_SHORTCUT_CAPTURE = "shortcutCapture";

/** Production Nexus Tools instance. */
export const DEFAULT_API_BASE_URL = "https://tools.services.nexus";

/** Hosts allowed by the `http` capability in `src-tauri/capabilities/default.json`. */
export const ALLOWED_API_BASE_URLS = [
  "https://tools.services.nexus",
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

export function isAllowedBaseUrl(url: string): boolean {
  return ALLOWED_API_BASE_URLS.includes(normalizeBaseUrl(url));
}

/**
 * The stored value is re-validated against the allowlist on every read: a
 * hand-edited or corrupted store must not be able to point `openUrl` at an
 * arbitrary host (the `http` capability would already reject API calls).
 */
export async function getApiBaseUrl(): Promise<string> {
  const store = await getStore();
  const value = await store.get<string>(KEY_API_BASE_URL);

  if (!value || !isAllowedBaseUrl(value)) {
    return DEFAULT_API_BASE_URL;
  }

  return normalizeBaseUrl(value);
}

export async function setApiBaseUrl(url: string): Promise<void> {
  const store = await getStore();
  await store.set(KEY_API_BASE_URL, normalizeBaseUrl(url));
}

/**
 * Global shortcuts, written in the format the `global-shortcut` plugin parses:
 * modifiers then one key, e.g. `Ctrl+Shift+KeyB`. Key names match the DOM's
 * `KeyboardEvent.code`, so a recorded combination maps across as-is.
 */
export const DEFAULT_SHORTCUTS = {
  search: "Ctrl+Shift+KeyB",
  capture: "Ctrl+Shift+KeyS",
} as const;

export type Shortcuts = { search: string; capture: string };

export async function getShortcuts(): Promise<Shortcuts> {
  const store = await getStore();

  return {
    search:
      (await store.get<string>(KEY_SHORTCUT_SEARCH)) ?? DEFAULT_SHORTCUTS.search,
    capture:
      (await store.get<string>(KEY_SHORTCUT_CAPTURE)) ??
      DEFAULT_SHORTCUTS.capture,
  };
}

export async function setShortcuts(shortcuts: Shortcuts): Promise<void> {
  const store = await getStore();
  await store.set(KEY_SHORTCUT_SEARCH, shortcuts.search);
  await store.set(KEY_SHORTCUT_CAPTURE, shortcuts.capture);
}

/** Turns `Ctrl+Shift+KeyB` into `Ctrl + Maj + B` for display. */
export function formatShortcut(accelerator: string): string {
  return accelerator
    .split("+")
    .map((token) => {
      switch (token) {
        case "Shift":
          return "Maj";
        case "Super":
          return "Win";
        default:
          return token.replace(/^Key/, "").replace(/^Digit/, "");
      }
    })
    .join(" + ");
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
