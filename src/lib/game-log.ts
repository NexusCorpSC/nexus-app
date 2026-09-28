import { invoke } from "@tauri-apps/api/core";

/**
 * Star Citizen's `Game.log`, followed from Rust (`src-tauri/src/game_log.rs`).
 *
 * Rust reads the file and recognises the lines; what to do about them is
 * decided here, in the main window, which holds the session
 * (`src/hooks/use-game-log.ts`).
 */

/** A blueprint the HUD announced. Carries a {@link BlueprintReceived}. */
export const GAME_LOG_BLUEPRINT_EVENT = "game-log://blueprint";

/** Pressed on the toast offering to add one. Carries an {@link AddFromLog}. */
export const GAME_LOG_ADD_BLUEPRINT_EVENT = "game-log://add-blueprint";

export type BlueprintReceived = {
  /** The name as the game spells it. */
  name: string;
  /** The timestamp the log line opens with, as written. */
  loggedAt: string;
};

export type AddFromLog = {
  blueprintId: string;
  name: string;
  slug: string;
};

/** Mirrors `GameLogStatus` in `src-tauri/src/game_log.rs`. */
export type GameLogStatus = {
  /** The file followed, or that would be. */
  path: string;
  enabled: boolean;
  exists: boolean;
};

/** Makes Rust follow the stored settings: start, stop or move the watcher. */
export function syncGameLog(): Promise<void> {
  return invoke("game_log_sync");
}

export function getGameLogStatus(): Promise<GameLogStatus> {
  return invoke("game_log_status");
}
