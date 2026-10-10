import { invoke } from "@tauri-apps/api/core";

/**
 * The windows the main window can bring up over the game, by the label
 * `tauri.conf.json` gives them.
 */
export type OverlayLabel =
  | "overlay"
  | "squad"
  | "plan"
  | "map"
  | "nps"
  | "notes"
  | "cargo"
  | "chat";

/** Shows an overlay — never hides it, unlike its shortcut. */
export function showOverlay(label: OverlayLabel): Promise<void> {
  return invoke("show_overlay", { label });
}
