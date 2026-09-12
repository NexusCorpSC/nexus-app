import { invoke } from "@tauri-apps/api/core";

/**
 * How much of the game each overlay lets through.
 *
 * Per window rather than one setting for the three: the cargo sheet is dense
 * text that wants a surface behind it, while the squad list was built to be
 * read through a cockpit. The button on a window steps that window through
 * the modes; the global shortcut takes all three to the same one at once.
 *
 * The live value is held by Rust — the shortcut has to reach windows nobody has
 * opened yet — and this module is only the wire. What each mode *looks* like is
 * `overlaySkin` below; the React side is in `use-overlay-opacity.ts`.
 */

/** Emitted by Rust to every window whenever any of the three changes. */
export const OVERLAY_OPACITY_EVENT = "overlay://opacity";

/** The window labels this applies to, as declared in `tauri.conf.json`. */
export type OverlayLabel = "notes" | "cargo" | "squad";

/**
 * The three modes, in the order the button steps through them.
 *
 * - `clear`: no surface at all, the game shows through the text;
 * - `shaded`: a faint dark tint behind the window, enough to keep the text
 *   readable over a lit planet without hiding what is behind it;
 * - `opaque`: the panel, a window that stands on its own.
 *
 * Mirrors `OverlayMode` in `src-tauri/src/lib.rs`, string for string.
 */
export const OVERLAY_MODES = ["clear", "shaded", "opaque"] as const;

export type OverlayMode = (typeof OVERLAY_MODES)[number];

export type OverlayOpacity = Record<OverlayLabel, OverlayMode>;

export function isOverlayMode(value: unknown): value is OverlayMode {
  return (
    typeof value === "string" &&
    (OVERLAY_MODES as readonly string[]).includes(value)
  );
}

/** The mode after this one — the button's next stop. */
export function nextOverlayMode(mode: OverlayMode): OverlayMode {
  const index = OVERLAY_MODES.indexOf(mode);
  return OVERLAY_MODES[(index + 1) % OVERLAY_MODES.length];
}

/** How each mode is named to the user. */
export const OVERLAY_MODE_LABELS: Record<OverlayMode, string> = {
  clear: "transparent",
  shaded: "ombré",
  opaque: "opaque",
};

/**
 * What each overlay has always looked like, and what they open on until the
 * main window hands the stored choice over. Mirrors `Default for OverlayOpacity`
 * in `src-tauri/src/lib.rs`.
 */
export const DEFAULT_OVERLAY_OPACITY: OverlayOpacity = {
  notes: "opaque",
  cargo: "opaque",
  squad: "clear",
};

/** Steps one overlay to its next mode. Called by the button that overlay carries. */
export function cycleOverlayOpacity(label: OverlayLabel): Promise<void> {
  return invoke("toggle_overlay_opacity", { label });
}

/**
 * Hands the stored choice over to Rust at startup, from the main window — the
 * same handover the shortcuts and the notification corner go through.
 */
export function applyOverlayOpacity(opacity: OverlayOpacity): Promise<void> {
  return invoke("set_overlay_opacity", { opacity });
}

/** The mode the calling window is in, asked as it mounts. */
export function readOverlayMode(label: OverlayLabel): Promise<OverlayMode> {
  return invoke<OverlayMode>("overlay_mode", { label });
}

/**
 * The panel: a window that stands on its own, over whatever is behind it.
 */
const OVERLAY_PANEL =
  "rounded-xl border border-white/10 bg-[#061E30]/95 shadow-2xl backdrop-blur-xl";

/**
 * No panel at all — the game shows through the text.
 *
 * Legibility then comes from a shadow behind every glyph rather than from a
 * surface: two layers, a tight one for the edge of each letter and a wider halo
 * that darkens the pixels around it. One layer is not enough over a lit planet.
 *
 * Only the *window* loses its background. The fields and buttons inside keep
 * their own faint tint, because a control with nothing behind it is unusable
 * over a game — which is the compromise the squad overlay was built on.
 */
const OVERLAY_SEE_THROUGH =
  "[text-shadow:0_1px_2px_rgb(0_0_0/0.95),0_0_8px_rgb(0_0_0/0.75)]";

/**
 * In between: the glyph shadow of the see-through mode, plus a faint dark
 * tint behind the whole window — a shadow the game is still seen through, not
 * a surface. For the cockpit that is too bright for the text alone and too
 * busy to hide behind a panel.
 */
const OVERLAY_SHADED = `rounded-xl bg-black/35 ${OVERLAY_SEE_THROUGH}`;

/** The classes an overlay's root element takes for the current mode. */
export function overlaySkin(mode: OverlayMode): string {
  switch (mode) {
    case "opaque":
      return OVERLAY_PANEL;
    case "shaded":
      return OVERLAY_SHADED;
    default:
      return OVERLAY_SEE_THROUGH;
  }
}
