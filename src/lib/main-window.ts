import { invoke } from "@tauri-apps/api/core";

/**
 * Brings the main window up on `route`, from a window that has no room to show
 * the thing itself — a toast, or the search palette.
 *
 * The main window is usually put away or minimised behind the game, so this
 * cannot be a plain router navigation: Rust has to show the window first (see
 * `open_main_route` in `src-tauri/src/lib.rs`).
 */
export function openMainRoute(route: string): Promise<void> {
  return invoke("open_main_route", { route });
}
