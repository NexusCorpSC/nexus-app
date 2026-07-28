import { invoke } from "@tauri-apps/api/core";
import type { ShortcutAction, Shortcuts } from "@/lib/settings";

/** A combination the system refused to hand over (see `src-tauri/src/lib.rs`). */
export type ShortcutRejection = {
  action: ShortcutAction;
  accelerator: string;
  reason: string;
};

/**
 * Binds the global shortcuts and returns the ones that could not be taken.
 *
 * Each combination is bound on its own: a conflict costs that one shortcut and
 * nothing else, so the app never ends up with none of them.
 */
export function applyShortcuts(
  shortcuts: Shortcuts,
): Promise<ShortcutRejection[]> {
  return invoke<ShortcutRejection[]>("set_shortcuts", { shortcuts });
}

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  search: "Recherche rapide",
  capture: "Capture de zone",
  notes: "Bloc-notes",
};
