import { invoke } from "@tauri-apps/api/core";

/**
 * Locking an overlay: the window stops taking the mouse, so a click on it
 * reaches the game underneath — except on the button that unlocks it.
 *
 * The one thing an always-on-top window over a game cannot help doing is
 * catching clicks meant for what is behind it. Locked, it is a picture: the
 * roster stays readable, the cursor goes through it, and only the little lock
 * in the header still answers.
 *
 * Held by Rust, because a window that ignores the cursor never sees it again:
 * the webview cannot tell when the pointer is over its own unlock button. Rust
 * watches the cursor, and hands the window the mouse back only while it is
 * over the zone the button reported (`src-tauri/src/lib.rs`). The React side is
 * in `use-overlay-lock.ts`.
 */

/** Emitted by Rust to the window whose lock changed, carrying `true` or `false`. */
export const OVERLAY_LOCK_EVENT = "overlay://lock";

/**
 * Where the unlock button is, in CSS pixels from the window's top-left corner —
 * what `getBoundingClientRect` gives, which Rust scales to the screen itself.
 */
export interface UnlockZone {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Locks the window, or moves the zone of a window already locked: called again
 * whenever the button's rectangle changes, since the window resizes.
 */
export function lockOverlay(label: string, zone: UnlockZone): Promise<void> {
  return invoke("lock_overlay", { label, zone });
}

export function unlockOverlay(label: string): Promise<void> {
  return invoke("unlock_overlay", { label });
}

/** Whether the calling window is locked, asked as it mounts. */
export function readOverlayLocked(label: string): Promise<boolean> {
  return invoke<boolean>("is_overlay_locked", { label });
}
