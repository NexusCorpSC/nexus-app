import { load, type Store } from "@tauri-apps/plugin-store";
import {
  DEFAULT_NOTIFICATION_CORNER,
  NOTIFICATION_CORNERS,
  type NotificationCorner,
} from "@/lib/notifications";
import {
  DEFAULT_OVERLAY_OPACITY,
  type OverlayOpacity,
} from "@/lib/overlay-opacity";
import { EMPTY_NOTE, type Note } from "@/types/nexus";

/**
 * Persistent desktop settings, stored by the Tauri `store` plugin in the
 * app data directory (survives restarts).
 */

const STORE_FILE = "settings.json";

const KEY_API_BASE_URL = "apiBaseUrl";
const KEY_SESSION_COOKIE = "sessionCookie";
const KEY_SHORTCUT_SEARCH = "shortcutSearch";
const KEY_SHORTCUT_CAPTURE = "shortcutCapture";
const KEY_SHORTCUT_NOTES = "shortcutNotes";
const KEY_SHORTCUT_CARGO = "shortcutCargo";
const KEY_SHORTCUT_SQUAD = "shortcutSquad";
const KEY_SHORTCUT_OPACITY = "shortcutOpacity";
const KEY_LOCAL_NOTE = "localNote";
const KEY_NOTIFICATION_CORNER = "notificationCorner";
const KEY_CARGO_SHEET = "cargoSheet";
const KEY_CARGO_SHIPS = "cargoShips";
const KEY_OVERLAY_OPACITY = "overlayOpacity";

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

/**
 * The one store of the application, shared by every module that persists
 * something. Handing the handle out rather than opening a second one: two
 * handles on the same file each keep their own copy in memory, and the last
 * write would win over an unread change.
 */
export function getSettingsStore(): Promise<Store> {
  return getStore();
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
  notes: "Ctrl+Shift+KeyN",
  cargo: "Ctrl+Shift+KeyG",
  squad: "Ctrl+Shift+KeyE",
  opacity: "Ctrl+Shift+KeyO",
} as const;

export type ShortcutAction = keyof typeof DEFAULT_SHORTCUTS;

export type Shortcuts = Record<ShortcutAction, string>;

export async function getShortcuts(): Promise<Shortcuts> {
  const store = await getStore();

  return {
    search:
      (await store.get<string>(KEY_SHORTCUT_SEARCH)) ??
      DEFAULT_SHORTCUTS.search,
    capture:
      (await store.get<string>(KEY_SHORTCUT_CAPTURE)) ??
      DEFAULT_SHORTCUTS.capture,
    notes:
      (await store.get<string>(KEY_SHORTCUT_NOTES)) ?? DEFAULT_SHORTCUTS.notes,
    cargo:
      (await store.get<string>(KEY_SHORTCUT_CARGO)) ?? DEFAULT_SHORTCUTS.cargo,
    squad:
      (await store.get<string>(KEY_SHORTCUT_SQUAD)) ?? DEFAULT_SHORTCUTS.squad,
    opacity:
      (await store.get<string>(KEY_SHORTCUT_OPACITY)) ??
      DEFAULT_SHORTCUTS.opacity,
  };
}

export async function setShortcuts(shortcuts: Shortcuts): Promise<void> {
  const store = await getStore();
  await store.set(KEY_SHORTCUT_SEARCH, shortcuts.search);
  await store.set(KEY_SHORTCUT_CAPTURE, shortcuts.capture);
  await store.set(KEY_SHORTCUT_NOTES, shortcuts.notes);
  await store.set(KEY_SHORTCUT_CARGO, shortcuts.cargo);
  await store.set(KEY_SHORTCUT_SQUAD, shortcuts.squad);
  await store.set(KEY_SHORTCUT_OPACITY, shortcuts.opacity);
}

/**
 * Whether each overlay draws its panel — the only durable copy of it. Rust holds
 * what is in force and is handed this at startup (`src/lib/overlay-opacity.ts`).
 *
 * Read field by field rather than as a whole so that a store written by an older
 * version, which knew nothing of this, still yields each window its own default
 * instead of one missing key costing all three.
 */
export async function getOverlayOpacity(): Promise<OverlayOpacity> {
  const store = await getStore();
  const stored = await store.get<Partial<OverlayOpacity>>(KEY_OVERLAY_OPACITY);

  return {
    notes: stored?.notes ?? DEFAULT_OVERLAY_OPACITY.notes,
    cargo: stored?.cargo ?? DEFAULT_OVERLAY_OPACITY.cargo,
    squad: stored?.squad ?? DEFAULT_OVERLAY_OPACITY.squad,
  };
}

export async function setOverlayOpacity(
  opacity: OverlayOpacity,
): Promise<void> {
  const store = await getStore();
  await store.set(KEY_OVERLAY_OPACITY, opacity);
}

/**
 * The scratch pad kept for signed-out users. Signing in does not merge it into
 * the online note: the two live side by side, and whichever applies is decided
 * by the session (see `src/lib/notes.ts`).
 */
export async function getLocalNote(): Promise<Note> {
  const store = await getStore();
  return (await store.get<Note>(KEY_LOCAL_NOTE)) ?? EMPTY_NOTE;
}

export async function setLocalNote(content: string): Promise<Note> {
  const store = await getStore();
  const note: Note = { content, updatedAt: new Date().toISOString() };
  await store.set(KEY_LOCAL_NOTE, note);
  return note;
}

/**
 * The corner the notification overlay hangs from.
 *
 * Re-validated on read, like the API URL above: a hand-edited or corrupted
 * store must not leave Rust with a corner it cannot parse — it would refuse
 * every notification rather than just this setting.
 */
export async function getNotificationCorner(): Promise<NotificationCorner> {
  const store = await getStore();
  const value = await store.get<NotificationCorner>(KEY_NOTIFICATION_CORNER);

  return value && NOTIFICATION_CORNERS.includes(value)
    ? value
    : DEFAULT_NOTIFICATION_CORNER;
}

export async function setNotificationCorner(
  corner: NotificationCorner,
): Promise<void> {
  const store = await getStore();
  await store.set(KEY_NOTIFICATION_CORNER, corner);
}

/**
 * The cargo sheet, kept entirely on this machine: it is a scratch pad for a
 * haul in progress, not shared data. `null` means no sheet has been started.
 */
export async function getStoredCargoSheet(): Promise<unknown> {
  const store = await getStore();
  return (await store.get<unknown>(KEY_CARGO_SHEET)) ?? null;
}

export async function setStoredCargoSheet(sheet: unknown): Promise<void> {
  const store = await getStore();

  if (sheet === null) await store.delete(KEY_CARGO_SHEET);
  else await store.set(KEY_CARGO_SHEET, sheet);
}

/**
 * Last known ship list from `/api/cargo-ships`. The only part of the cargo
 * sheet that comes from the network, hence the only part worth caching: with
 * it, the tool opens and works with no connection at all.
 */
export async function getCachedCargoShips(): Promise<unknown> {
  const store = await getStore();
  return (await store.get<unknown>(KEY_CARGO_SHIPS)) ?? null;
}

export async function setCachedCargoShips(ships: unknown): Promise<void> {
  const store = await getStore();
  await store.set(KEY_CARGO_SHIPS, ships);
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
