import { load, type Store } from "@tauri-apps/plugin-store";
import {
  DEFAULT_NOTIFICATION_CORNER,
  NOTIFICATION_CORNERS,
  type NotificationCorner,
} from "@/lib/notifications";
import {
  DEFAULT_OVERLAY_OPACITY,
  isOverlayMode,
  type OverlayLabel,
  type OverlayMode,
  type OverlayOpacity,
} from "@/lib/overlay-opacity";
import {
  DEFAULT_RAID_LAYOUT,
  isRaidColumns,
  type RaidLayout,
} from "@/lib/raid-layout";
import { detectSystemLocale, isLocale, type Locale } from "@/i18n/locale";
import { translator } from "@/i18n/translate";
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
const KEY_SHORTCUT_PLAN = "shortcutPlan";
const KEY_SHORTCUT_MAP = "shortcutMap";
const KEY_SHORTCUT_NPS = "shortcutNps";
const KEY_SHORTCUT_CHAT = "shortcutChat";
const KEY_SHORTCUT_TALK = "shortcutTalk";
const KEY_SHORTCUT_OPACITY = "shortcutOpacity";
const KEY_SHORTCUT_LOCK = "shortcutLock";
const KEY_SHORTCUT_RADIAL = "shortcutRadial";
const KEY_LOCAL_NOTE = "localNote";
const KEY_NOTIFICATION_CORNER = "notificationCorner";
const KEY_CARGO_SHEET = "cargoSheet";
const KEY_PINNED_MAP = "pinnedMap";
const KEY_NPS_DESTINATION = "npsDestination";
const KEY_NPS_SYSTEM = "npsSystem";
const KEY_CARGO_SHIPS = "cargoShips";
const KEY_OVERLAY_OPACITY = "overlayOpacity";
const KEY_RAID_LAYOUT = "raidLayout";
const KEY_GAME_LOG_DIR = "gameLogDir";
const KEY_GAME_LOG_ENABLED = "gameLogEnabled";
const KEY_CONTRIB_NOTIFICATIONS = "contribNotifications";
const KEY_CONTRIB_SINCE = "contribSince";
const KEY_ORDER_NOTIFICATIONS = "orderNotifications";
const KEY_ORDERS_SINCE = "ordersSince";
const KEY_LOCALE = "locale";

/** Production Nexus Tools instance. */
export const DEFAULT_API_BASE_URL = "https://tools.services.nexus";

/**
 * Hosts allowed by the `http` capability in `src-tauri/capabilities/default.json`.
 * Copied a third time in `src-tauri/src/event_feed.rs`, whose requests answer
 * to no capability: the three lists must say the same thing.
 */
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
  plan: "Ctrl+Shift+KeyP",
  map: "Ctrl+Shift+KeyM",
  nps: "Ctrl+Shift+KeyK",
  chat: "Ctrl+Shift+KeyH",
  // Held, not pressed: the microphone is open while it is down.
  talk: "Ctrl+Shift+KeyJ",
  opacity: "Ctrl+Shift+KeyO",
  lock: "Ctrl+Shift+KeyL",
  // Held, not pressed: the radial menu stays up while it is down.
  radial: "Alt+KeyV",
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
    plan:
      (await store.get<string>(KEY_SHORTCUT_PLAN)) ?? DEFAULT_SHORTCUTS.plan,
    map: (await store.get<string>(KEY_SHORTCUT_MAP)) ?? DEFAULT_SHORTCUTS.map,
    nps: (await store.get<string>(KEY_SHORTCUT_NPS)) ?? DEFAULT_SHORTCUTS.nps,
    chat:
      (await store.get<string>(KEY_SHORTCUT_CHAT)) ?? DEFAULT_SHORTCUTS.chat,
    talk:
      (await store.get<string>(KEY_SHORTCUT_TALK)) ?? DEFAULT_SHORTCUTS.talk,
    opacity:
      (await store.get<string>(KEY_SHORTCUT_OPACITY)) ??
      DEFAULT_SHORTCUTS.opacity,
    lock:
      (await store.get<string>(KEY_SHORTCUT_LOCK)) ?? DEFAULT_SHORTCUTS.lock,
    radial:
      (await store.get<string>(KEY_SHORTCUT_RADIAL)) ??
      DEFAULT_SHORTCUTS.radial,
  };
}

export async function setShortcuts(shortcuts: Shortcuts): Promise<void> {
  const store = await getStore();
  await store.set(KEY_SHORTCUT_SEARCH, shortcuts.search);
  await store.set(KEY_SHORTCUT_CAPTURE, shortcuts.capture);
  await store.set(KEY_SHORTCUT_NOTES, shortcuts.notes);
  await store.set(KEY_SHORTCUT_CARGO, shortcuts.cargo);
  await store.set(KEY_SHORTCUT_SQUAD, shortcuts.squad);
  await store.set(KEY_SHORTCUT_PLAN, shortcuts.plan);
  await store.set(KEY_SHORTCUT_MAP, shortcuts.map);
  await store.set(KEY_SHORTCUT_NPS, shortcuts.nps);
  await store.set(KEY_SHORTCUT_CHAT, shortcuts.chat);
  await store.set(KEY_SHORTCUT_TALK, shortcuts.talk);
  await store.set(KEY_SHORTCUT_OPACITY, shortcuts.opacity);
  await store.set(KEY_SHORTCUT_LOCK, shortcuts.lock);
  await store.set(KEY_SHORTCUT_RADIAL, shortcuts.radial);
}

/**
 * One stored mode, whatever version wrote it.
 *
 * The store used to hold a boolean per overlay — panel or not — before the
 * shaded mode came between the two. `true` was the panel and `false` the game
 * seen through, and they still are. Anything else is the window's own default.
 */
function storedMode(value: unknown, label: OverlayLabel): OverlayMode {
  if (isOverlayMode(value)) return value;
  if (value === true) return "opaque";
  if (value === false) return "clear";
  return DEFAULT_OVERLAY_OPACITY[label];
}

/**
 * How much each overlay lets through — the only durable copy of it. Rust holds
 * what is in force and is handed this at startup (`src/lib/overlay-opacity.ts`).
 *
 * Read field by field rather than as a whole so that a store written by an older
 * version, which knew nothing of this, still yields each window its own default
 * instead of one missing key costing them all.
 */
export async function getOverlayOpacity(): Promise<OverlayOpacity> {
  const store = await getStore();
  const stored =
    await store.get<Partial<Record<OverlayLabel, unknown>>>(
      KEY_OVERLAY_OPACITY,
    );

  return {
    notes: storedMode(stored?.notes, "notes"),
    cargo: storedMode(stored?.cargo, "cargo"),
    squad: storedMode(stored?.squad, "squad"),
    plan: storedMode(stored?.plan, "plan"),
    map: storedMode(stored?.map, "map"),
    nps: storedMode(stored?.nps, "nps"),
    chat: storedMode(stored?.chat, "chat"),
  };
}

export async function setOverlayOpacity(
  opacity: OverlayOpacity,
): Promise<void> {
  const store = await getStore();
  await store.set(KEY_OVERLAY_OPACITY, opacity);
}

/**
 * How this player lays the raid out — columns, and the order of the squads.
 *
 * Personal by design (see `src/lib/raid-layout.ts`), so it is stored here and
 * never sent anywhere: two raiders watching the same fifteen people have no
 * reason to want the same arrangement.
 *
 * Re-validated field by field on read, like the API URL and the notification
 * corner: a hand-edited store must not hand the overlay a column count it
 * cannot lay out, and a stored order is treated as a preference over the real
 * roster rather than as the roster.
 */
export async function getRaidLayout(): Promise<RaidLayout> {
  const store = await getStore();
  const stored = await store.get<Partial<RaidLayout>>(KEY_RAID_LAYOUT);

  return {
    columns: isRaidColumns(stored?.columns)
      ? stored.columns
      : DEFAULT_RAID_LAYOUT.columns,
    raidId: typeof stored?.raidId === "string" ? stored.raidId : null,
    order: Array.isArray(stored?.order)
      ? stored.order.filter((id): id is string => typeof id === "string")
      : [],
  };
}

export async function setRaidLayout(layout: RaidLayout): Promise<void> {
  const store = await getStore();
  await store.set(KEY_RAID_LAYOUT, layout);
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
 * Where Star Citizen writes its `Game.log`, and whether it is followed at all.
 * Read from Rust too (`src-tauri/src/game_log.rs`), which applies the same
 * defaults: the keys and the default folder are copied there.
 */
export type GameLogSettings = {
  /** The game's folder — the one holding `Game.log`, not the file itself. */
  dir: string;
  enabled: boolean;
};

/** Where the RSI launcher installs the live build unless told otherwise. */
export const DEFAULT_GAME_LOG_DIR =
  "C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE";

export async function getGameLogSettings(): Promise<GameLogSettings> {
  const store = await getStore();
  const dir = await store.get<unknown>(KEY_GAME_LOG_DIR);
  const enabled = await store.get<unknown>(KEY_GAME_LOG_ENABLED);

  return {
    dir:
      typeof dir === "string" && dir.trim() ? dir.trim() : DEFAULT_GAME_LOG_DIR,
    enabled: typeof enabled === "boolean" ? enabled : true,
  };
}

export async function setGameLogSettings(
  settings: GameLogSettings,
): Promise<void> {
  const store = await getStore();
  await store.set(KEY_GAME_LOG_DIR, settings.dir.trim());
  await store.set(KEY_GAME_LOG_ENABLED, settings.enabled);
}

/**
 * Whether a published contribution, one sent back for changes, an achievement
 * or a new level raises a notification. On unless turned off.
 */
export async function getContribNotifications(): Promise<boolean> {
  const store = await getStore();
  const value = await store.get<unknown>(KEY_CONTRIB_NOTIFICATIONS);
  return typeof value === "boolean" ? value : true;
}

export async function setContribNotifications(enabled: boolean): Promise<void> {
  const store = await getStore();
  await store.set(KEY_CONTRIB_NOTIFICATIONS, enabled);
}

/**
 * The site's clock at the last read of the contribution events, sent back as
 * `since`: kept across restarts so nothing is announced twice, or missed while
 * the app was closed.
 *
 * One mark per account and per instance: another player signing in on this
 * machine, or the same player on another instance, starts from their own
 * first read rather than from someone else's clock.
 */
async function accountInstanceKey(userId: string): Promise<string> {
  return `${await getApiBaseUrl()}|${userId}`;
}

export async function getContribSince(userId: string): Promise<string | null> {
  const store = await getStore();
  const marks = await store.get<unknown>(KEY_CONTRIB_SINCE);
  if (!marks || typeof marks !== "object") return null;
  const value = (marks as Record<string, unknown>)[
    await accountInstanceKey(userId)
  ];
  return typeof value === "string" ? value : null;
}

export async function setContribSince(
  userId: string,
  since: string,
): Promise<void> {
  const store = await getStore();
  const marks = await store.get<unknown>(KEY_CONTRIB_SINCE);
  await store.set(KEY_CONTRIB_SINCE, {
    // A mark from before this format was a bare string: it is dropped.
    ...(marks && typeof marks === "object" ? marks : {}),
    [await accountInstanceKey(userId)]: since,
  });
}

/**
 * Whether an order received by one of the reader's shops, or a step taken on
 * one of their orders, raises a notification. On unless turned off.
 */
export async function getOrderNotifications(): Promise<boolean> {
  const store = await getStore();
  const value = await store.get<unknown>(KEY_ORDER_NOTIFICATIONS);
  return typeof value === "boolean" ? value : true;
}

export async function setOrderNotifications(enabled: boolean): Promise<void> {
  const store = await getStore();
  await store.set(KEY_ORDER_NOTIFICATIONS, enabled);
}

/**
 * The site's clock at the last read of the orders, sent back as `since`: one
 * mark per account and per instance, like the contribution events'.
 */
export async function getOrdersSince(userId: string): Promise<string | null> {
  const store = await getStore();
  const marks = await store.get<unknown>(KEY_ORDERS_SINCE);
  if (!marks || typeof marks !== "object") return null;
  const value = (marks as Record<string, unknown>)[
    await accountInstanceKey(userId)
  ];
  return typeof value === "string" ? value : null;
}

export async function setOrdersSince(
  userId: string,
  since: string,
): Promise<void> {
  const store = await getStore();
  const marks = await store.get<unknown>(KEY_ORDERS_SINCE);
  await store.set(KEY_ORDERS_SINCE, {
    ...(marks && typeof marks === "object" ? marks : {}),
    [await accountInstanceKey(userId)]: since,
  });
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
 * The place whose map the Carte overlay shows, kept as a slug.
 *
 * Stored rather than held in memory because the overlay is created at startup
 * and outlives any navigation: closing it and reopening it mid-drop should show
 * the same map, not an empty window.
 */
export async function getPinnedMap(): Promise<string | null> {
  const store = await getStore();
  return (await store.get<string>(KEY_PINNED_MAP)) ?? null;
}

export async function setPinnedMap(slug: string | null): Promise<void> {
  const store = await getStore();

  if (slug === null) await store.delete(KEY_PINNED_MAP);
  else await store.set(KEY_PINNED_MAP, slug);
}

/**
 * The place the NPS overlay guides to, kept as a slug — for the same reason
 * as the pinned map: the overlay outlives a hide and a show.
 */
export async function getNpsDestination(): Promise<string | null> {
  const store = await getStore();
  return (await store.get<string>(KEY_NPS_DESTINATION)) ?? null;
}

export async function setNpsDestination(slug: string | null): Promise<void> {
  const store = await getStore();

  if (slug === null) await store.delete(KEY_NPS_DESTINATION);
  else await store.set(KEY_NPS_DESTINATION, slug);
}

/**
 * The star system the NPS last saw the player in. Out in space, far from any
 * body, a reading does not say which system it belongs to: this one is kept.
 */
export async function getNpsSystem(): Promise<string | null> {
  const store = await getStore();
  return (await store.get<string>(KEY_NPS_SYSTEM)) ?? null;
}

export async function setNpsSystem(slug: string): Promise<void> {
  const store = await getStore();
  await store.set(KEY_NPS_SYSTEM, slug);
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

/** Turns `Ctrl+Shift+KeyB` into `Ctrl + Maj + B` for display (in French). */
export function formatShortcut(accelerator: string): string {
  const t = translator("Shortcuts");

  return accelerator
    .split("+")
    .map((token) => {
      switch (token) {
        case "Shift":
          return t("keys.shift");
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

/**
 * The language of the app. On first launch, the system's own if the app
 * speaks it, French otherwise; written down at once, so it stays put even if
 * the system language changes later — only the settings change it.
 */
export async function getLocaleSetting(): Promise<Locale> {
  const store = await getStore();
  const value = await store.get<string>(KEY_LOCALE);
  if (isLocale(value)) return value;

  const detected = detectSystemLocale();
  await store.set(KEY_LOCALE, detected);
  return detected;
}

export async function setLocaleSetting(locale: Locale): Promise<void> {
  const store = await getStore();
  await store.set(KEY_LOCALE, locale);
}
