import type { VehicleState } from "@/lib/telemetry";

/**
 * Interface themes, one per ship manufacturer, plus Nexus's own.
 *
 * A theme is only a name here: its colours and shapes are seeds in
 * `src/themes.css`, set on `<html data-theme="…">`. The main window decides
 * which one is in force (`src/hooks/use-ship-theme.ts`) and tells the
 * overlays, so that every window changes together.
 */

export const THEME_IDS = [
  "nexus",
  "drake",
  "argo",
  "gatac",
  "aopoa",
  "aegis",
  "anvil",
  "rsi",
  "origin",
  "crusader",
  "misc",
  "banu",
  "vanduul",
  "esperia",
  "mirai",
  "cnou",
  "greycat",
  "kruger",
  "tumbril",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ThemeId = "nexus";

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

/**
 * Manufacturers' names as the game writes them, never translated. Nexus has
 * none: its label comes from the translations.
 */
export const MANUFACTURER_NAMES: Record<Exclude<ThemeId, "nexus">, string> = {
  drake: "Drake Interplanetary",
  argo: "Argo Astronautics",
  gatac: "Gatac Manufacture",
  aopoa: "Aopoa",
  aegis: "Aegis Dynamics",
  anvil: "Anvil Aerospace",
  rsi: "Roberts Space Industries",
  origin: "Origin Jumpworks",
  crusader: "Crusader Industries",
  misc: "MISC",
  banu: "Banu",
  vanduul: "Vanduul",
  esperia: "Esperia",
  mirai: "Mirai",
  cnou: "Consolidated Outland",
  greycat: "Greycat Industrial",
  kruger: "Kruger Intergalactic",
  tumbril: "Tumbril",
};

/** The signature colour of each theme, for swatches drawn outside of it. */
export const THEME_SWATCHES: Record<ThemeId, { accent: string; tint: string }> = {
  nexus: { accent: "#62d4ff", tint: "#0b3a5a" },
  drake: { accent: "#ffc400", tint: "#2a2414" },
  argo: { accent: "#ff7f26", tint: "#1a1612" },
  gatac: { accent: "#a77bff", tint: "#1e1033" },
  aopoa: { accent: "#2fe4ee", tint: "#08262e" },
  aegis: { accent: "#ff5252", tint: "#1b2129" },
  anvil: { accent: "#3fe6cf", tint: "#0d2a27" },
  rsi: { accent: "#4ea8ff", tint: "#0e2340" },
  origin: { accent: "#1d4f9e", tint: "#f3efe7" },
  crusader: { accent: "#5cc8ff", tint: "#122b3d" },
  misc: { accent: "#2fd0c4", tint: "#0f2a2c" },
  banu: { accent: "#e9b44c", tint: "#5fb39c" },
  vanduul: { accent: "#ff3b46", tint: "#1a0c0e" },
  esperia: { accent: "#ff6f91", tint: "#2a1420" },
  mirai: { accent: "#ff2bd6", tint: "#00f0ff" },
  cnou: { accent: "#9dff3c", tint: "#142414" },
  greycat: { accent: "#f2d43a", tint: "#1d222b" },
  kruger: { accent: "#e8894a", tint: "#221a16" },
  tumbril: { accent: "#d4b06a", tint: "#221f17" },
};

/**
 * The prefix of the game's class names (`DRAK_Cutlass_Black`) for each
 * manufacturer. Several prefixes can lead to one theme: the Xi'an ships of
 * Aopoa come as XIAN or XNAA, and RSI's ground vehicles as RSI too.
 */
const CLASS_PREFIXES: Record<string, ThemeId> = {
  DRAK: "drake",
  ARGO: "argo",
  GAMA: "gatac",
  XIAN: "aopoa",
  XNAA: "aopoa",
  AOPOA: "aopoa",
  AEGS: "aegis",
  ANVL: "anvil",
  RSI: "rsi",
  ORIG: "origin",
  CRUS: "crusader",
  MISC: "misc",
  BANU: "banu",
  VNCL: "vanduul",
  ESPR: "esperia",
  MRAI: "mirai",
  CNOU: "cnou",
  GRIN: "greycat",
  KRIG: "kruger",
  TMBL: "tumbril",
};

/**
 * Words of the manufacturer's name, for when the class name says nothing: the
 * telemetry is reverse-engineered, and the field may carry a name or a code.
 * Matched against the lower-cased name, longest first.
 */
const NAME_WORDS: [string, ThemeId][] = [
  ["consolidated", "cnou"],
  ["roberts", "rsi"],
  ["greycat", "greycat"],
  ["crusader", "crusader"],
  ["tumbril", "tumbril"],
  ["vanduul", "vanduul"],
  ["esperia", "esperia"],
  ["origin", "origin"],
  ["kruger", "kruger"],
  ["drake", "drake"],
  ["gatac", "gatac"],
  ["aopoa", "aopoa"],
  ["aegis", "aegis"],
  ["anvil", "anvil"],
  ["mirai", "mirai"],
  ["argo", "argo"],
  ["misc", "misc"],
  ["banu", "banu"],
];

/** The theme of a vehicle's manufacturer, or null when it is not known. */
export function themeForVehicle(
  vehicle: Pick<VehicleState, "className" | "manufacturer">,
): ThemeId | null {
  const prefix = vehicle.className.trim().split(/[_\s-]/, 1)[0]?.toUpperCase();
  if (prefix && prefix in CLASS_PREFIXES) return CLASS_PREFIXES[prefix];

  const maker = vehicle.manufacturer.trim();
  if (!maker) return null;
  const code = maker.toUpperCase();
  if (code in CLASS_PREFIXES) return CLASS_PREFIXES[code];
  const name = maker.toLowerCase();
  for (const [word, theme] of NAME_WORDS) {
    if (name.includes(word)) return theme;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* What every window applies                                           */
/* ------------------------------------------------------------------ */

/** The theme in force, broadcast by the main window. Carries an {@link ActiveTheme}. */
export const THEME_EVENT = "theme://active";

/** The appearance settings changed. Carries an {@link Appearance}. */
export const APPEARANCE_EVENT = "theme://appearance";

export type ActiveTheme = {
  theme: ThemeId;
  effects: boolean;
};

export type Appearance = {
  /** `ship`: the manufacturer of the ship flown, else `theme`. */
  mode: "ship" | "fixed";
  /** The theme outside of a cockpit, or always in `fixed` mode. */
  theme: ThemeId;
  /** Keep the last ship's theme after leaving its seat. */
  keepLastShip: boolean;
  /** Switch at a turret or crew seat too, not only at the pilot's. */
  anySeat: boolean;
  /** Announce a switch with a notification. */
  announce: boolean;
  /** Backdrop patterns, halos and HUD brackets. */
  effects: boolean;
};

export const DEFAULT_APPEARANCE: Appearance = {
  mode: "ship",
  theme: DEFAULT_THEME,
  keepLastShip: true,
  anySeat: false,
  announce: true,
  effects: true,
};

/** Sets the theme on this window's document. */
export function applyTheme({ theme, effects }: ActiveTheme): void {
  const root = document.documentElement;
  if (root.dataset.theme === theme && (root.dataset.effects !== "off") === effects) {
    return;
  }
  const animate =
    root.dataset.theme !== undefined &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (animate) {
    root.classList.add("nexus-theme-shift");
    window.setTimeout(() => root.classList.remove("nexus-theme-shift"), 600);
  }
  root.dataset.theme = theme;
  root.dataset.effects = effects ? "on" : "off";
}
