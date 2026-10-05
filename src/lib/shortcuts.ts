import { invoke } from "@tauri-apps/api/core";
import { translator } from "@/i18n/translate";
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

/** The name of what a shortcut does, in the language on screen. */
export function shortcutLabel(action: ShortcutAction): string {
  return translator("Shortcuts")(`labels.${action}`);
}

/**
 * Why a combination was refused, in the language on screen.
 *
 * Rust words its reasons in French (`apply_shortcuts` and
 * `register_system_wide` in `src-tauri/src/lib.rs`); the four it can give are
 * recognised here and told again. Anything else is shown as it came.
 */
export function describeShortcutRejection(reason: string): string {
  const t = translator("Shortcuts");

  if (reason === "déjà utilisée par un autre raccourci de Nexus") {
    return t("rejections.duplicate");
  }
  if (reason === "les raccourcis globaux sont indisponibles sur ce système") {
    return t("rejections.unavailable");
  }

  const invalid = /^combinaison invalide : (.*)$/s.exec(reason);
  if (invalid) return t("rejections.invalid", { error: invalid[1] });

  const refused = /^refusée par le système \((.*)\)$/s.exec(reason);
  if (refused) return t("rejections.refused", { error: refused[1] });

  return reason;
}
