/**
 * What the radial menu and the squad window say to each other.
 *
 * The menu window has neither the session nor the network: the squad window
 * does, lives as long as the app, and already holds the reader's squad with
 * every write shown before the server has agreed. So the menu is told what to
 * draw by the squad window, and hands squad actions back to it — the same
 * division as the «Prêt» button of a ready check notification.
 */

/** Window labels declared in `tauri.conf.json`. */
export const RADIAL_WINDOW = "radial";
export const SQUAD_WINDOW = "squad";

/** From Rust: the menu came up, with the combination that holds it open. */
export const RADIAL_OPEN_EVENT = "radial://open";

/** From Rust: where the pointer is. */
export const RADIAL_POINTER_EVENT = "radial://pointer";

/** From Rust: let go, act on the pointer it carries. */
export const RADIAL_RELEASE_EVENT = "radial://release";

/** From Rust: called off. */
export const RADIAL_CANCEL_EVENT = "radial://cancel";

/** Squad window → menu: the reader's own row, or `null` outside a squad. */
export const RADIAL_SQUAD_EVENT = "radial://squad";

/** Menu → squad window: tell me again, I just started. */
export const RADIAL_SQUAD_REQUEST_EVENT = "radial://squad-request";

/** Menu → squad window: flip one of the reader's two states. */
export const RADIAL_SQUAD_ACTION_EVENT = "radial://squad-action";

export type RadialOpened = {
  accelerator: string | null;
  /** Whether any overlay is locked: the lock sector unlocks them all if so. */
  locked: boolean;
};

/** A vector from the centre, 1 long at the rim; `y` grows downwards. */
export type RadialPointer = { x: number; y: number };

/** The reader as the menu needs them. */
export type RadialSquad = {
  squadId: string;
  squadName: string;
  ready: boolean;
  alive: boolean;
  readyCount: number;
  total: number;
};

export type RadialSquadAction = {
  action: "ready" | "alive";
  /** The squad the menu was drawn for: a squad switched since is left alone. */
  squadId: string;
};

export type RadialSector = "ready" | "alive" | "lock" | "capture";

/**
 * Where each sector sits, as the angle of its middle, clockwise from the top.
 *
 * Fixed whatever is shown: outside a squad the two squad sectors are gone, but
 * lock and capture stay where they were, so the flick for each is the same in
 * and out of a squad.
 */
export const SECTOR_ANGLES: Record<RadialSector, number> = {
  ready: 315,
  alive: 45,
  lock: 135,
  capture: 225,
};

/** Each sector's half-width, in degrees: four of them make the circle. */
export const SECTOR_HALF_WIDTH = 45;

/**
 * Below this, the pointer is in the centre and picks nothing: a hand resting
 * on the mouse, or someone who changed their mind.
 */
export const DEAD_ZONE = 0.3;

/** The sector the pointer is in, among those offered. */
export function sectorAt(
  pointer: RadialPointer,
  offered: readonly RadialSector[],
): RadialSector | null {
  if (Math.hypot(pointer.x, pointer.y) < DEAD_ZONE) return null;

  const angle =
    ((Math.atan2(pointer.x, -pointer.y) * 180) / Math.PI + 360) % 360;

  return (
    offered.find((sector) => {
      const distance = Math.abs(
        ((angle - SECTOR_ANGLES[sector] + 540) % 360) - 180,
      );
      return distance < SECTOR_HALF_WIDTH;
    }) ?? null
  );
}
