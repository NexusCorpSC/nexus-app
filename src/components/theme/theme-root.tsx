import { getCurrentWindow } from "@tauri-apps/api/window";
import { useFollowTheme, useShipTheme } from "@/hooks/use-ship-theme";

/** The main window decides the theme; the others follow it. */
export const THEME_KEEPER_WINDOW = "main";

function ThemeKeeper() {
  useShipTheme();
  return null;
}

function ThemeFollower() {
  useFollowTheme();
  return null;
}

/**
 * Marks the document with the kind of window it is, before the first render:
 * some themes draw the main window differently from the overlays, which sit
 * over the game (Origin is light in the window, dark over the game).
 */
export function markWindowKind(): void {
  document.documentElement.dataset.window =
    getCurrentWindow().label === THEME_KEEPER_WINDOW ? "main" : "overlay";
}

/** Puts the interface theme in force in this window. Renders nothing. */
export default function ThemeRoot() {
  return getCurrentWindow().label === THEME_KEEPER_WINDOW ? (
    <ThemeKeeper />
  ) : (
    <ThemeFollower />
  );
}
