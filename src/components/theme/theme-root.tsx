import { getCurrentWindow } from "@tauri-apps/api/window";
import { useFollowTheme, useShipTheme } from "@/hooks/use-ship-theme";

/** The main window decides the theme; the others follow it. */
const THEME_KEEPER_WINDOW = "main";

function ThemeKeeper() {
  useShipTheme();
  return null;
}

function ThemeFollower() {
  useFollowTheme();
  return null;
}

/** Puts the interface theme in force in this window. Renders nothing. */
export default function ThemeRoot() {
  return getCurrentWindow().label === THEME_KEEPER_WINDOW ? (
    <ThemeKeeper />
  ) : (
    <ThemeFollower />
  );
}
