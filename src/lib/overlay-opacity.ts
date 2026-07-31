import { invoke } from "@tauri-apps/api/core";

/**
 * Whether each overlay draws its panel or lets the game through.
 *
 * Per window rather than one flag for the three: the cargo sheet is dense text
 * that wants a surface behind it, while the squad list was built to be read
 * through a cockpit. The button on a window flips that window; the global
 * shortcut takes all three to the same mode at once.
 *
 * The live value is held by Rust — the shortcut has to reach windows nobody has
 * opened yet — and this module is only the wire. What each mode *looks* like is
 * `overlaySkin` below; the React side is in `use-overlay-opacity.ts`.
 */

/** Emitted by Rust to every window whenever any of the three changes. */
export const OVERLAY_OPACITY_EVENT = "overlay://opacity";

/** The window labels this applies to, as declared in `tauri.conf.json`. */
export type OverlayLabel = "notes" | "cargo" | "squad";

export type OverlayOpacity = Record<OverlayLabel, boolean>;

/**
 * What each overlay has always looked like, and what they open on until the
 * main window hands the stored choice over. Mirrors `Default for OverlayOpacity`
 * in `src-tauri/src/lib.rs`.
 */
export const DEFAULT_OVERLAY_OPACITY: OverlayOpacity = {
  notes: true,
  cargo: true,
  squad: false,
};

export function isOverlayLabel(label: string): label is OverlayLabel {
  return label in DEFAULT_OVERLAY_OPACITY;
}

/** Flips one overlay. Called by the button that overlay carries. */
export function toggleOverlayOpacity(label: OverlayLabel): Promise<void> {
  return invoke("toggle_overlay_opacity", { label });
}

/**
 * Hands the stored choice over to Rust at startup, from the main window — the
 * same handover the shortcuts and the notification corner go through.
 */
export function applyOverlayOpacity(opacity: OverlayOpacity): Promise<void> {
  return invoke("set_overlay_opacity", { opacity });
}

/** Whether the calling window is drawing its panel, asked as it mounts. */
export function readOverlayOpacity(label: OverlayLabel): Promise<boolean> {
  return invoke<boolean>("is_overlay_opaque", { label });
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

/** The classes an overlay's root element takes for the current mode. */
export function overlaySkin(opaque: boolean): string {
  return opaque ? OVERLAY_PANEL : OVERLAY_SEE_THROUGH;
}
