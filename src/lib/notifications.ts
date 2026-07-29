import { invoke } from "@tauri-apps/api/core";

/**
 * Notifications are drawn by a window of their own, hung from a corner of the
 * screen (see `src-tauri/src/notifications.rs`).
 *
 * Raising one is therefore a call into Rust rather than a React state update:
 * the window that raises a notification is rarely the window that shows it, and
 * is usually not on screen at all.
 */

export type NotificationKind = "info" | "success" | "warning" | "error";

export type NotificationInput = {
  kind?: NotificationKind;
  title: string;
  body?: string;
  /** Overrides the duration the overlay derives from `kind`. */
  timeoutMs?: number;
  /**
   * Route the main window opens when the toast is clicked. Give one whenever
   * there is something to do about the notification: the window it would be
   * done in is, by construction, not the one showing the toast.
   */
  route?: string;
};

/** A notification as it reaches the overlay, id assigned by Rust. */
export type AppNotification = {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string | null;
  timeoutMs: number | null;
  route: string | null;
};

/** Events the overlay listens for; the names are shared with Rust. */
export const NOTIFICATION_EVENT = "notifications://show";
export const NOTIFICATION_CORNER_EVENT = "notifications://corner";

/** Width of the stack in logical pixels. Rust sizes the window from it. */
export const NOTIFICATION_WIDTH = 340;

/** How many toasts stay on screen at once; older ones make way. */
export const MAX_VISIBLE_NOTIFICATIONS = 4;

/** Corners, in the spelling `Corner` is deserialised from in Rust. */
export const NOTIFICATION_CORNERS = [
  "bottom-right",
  "bottom-left",
  "top-right",
  "top-left",
] as const;

export type NotificationCorner = (typeof NOTIFICATION_CORNERS)[number];

/** Where Windows shows its own notifications, so it is where users look. */
export const DEFAULT_NOTIFICATION_CORNER: NotificationCorner = "bottom-right";

export const NOTIFICATION_CORNER_LABELS: Record<NotificationCorner, string> = {
  "bottom-right": "En bas à droite",
  "bottom-left": "En bas à gauche",
  "top-right": "En haut à droite",
  "top-left": "En haut à gauche",
};

/**
 * How long a toast stays up, by severity: long enough to read a failure, short
 * enough that a confirmation does not linger over the game.
 */
const TIMEOUTS: Record<NotificationKind, number> = {
  info: 6000,
  success: 5000,
  warning: 8000,
  error: 10000,
};

export function notificationTimeout(notification: AppNotification): number {
  return notification.timeoutMs ?? TIMEOUTS[notification.kind];
}

/** Raises a notification, from any window. */
export function notify(notification: NotificationInput): Promise<void> {
  return invoke("notify", { notification });
}

/** Moves the overlay to `corner`. Persisting the choice is `settings.ts`'s. */
export function applyNotificationCorner(
  corner: NotificationCorner,
): Promise<void> {
  return invoke("set_notification_corner", { corner });
}
