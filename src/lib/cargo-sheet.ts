import { emit } from "@tauri-apps/api/event";
import {
  getStoredCargoSheet,
  setStoredCargoSheet,
} from "@/lib/settings";
import {
  DEFAULT_MAX_CONTAINER,
  FIRST_MISSION_COUNTER,
  isContainerSize,
  MAX_VOLUME,
  missionName,
  nextMissionCounter,
  splitVolume,
  type CargoLine,
  type ContainerSize,
  type ParsedBulkLine,
} from "@/lib/cargo";

/**
 * The cargo sheet: one haul in progress, stored on this machine and nowhere
 * else. Nothing here talks to the API — the ship list, read once and cached,
 * is the only thing the tool ever asks the network for.
 *
 * `null` is a state of its own: no sheet has been started yet. It is what
 * decides whether a capture adds to the sheet or has to ask for a ship first.
 */

/** Announces a change to every window; each one re-reads the store. */
export const CARGO_EVENT = "cargo://changed";

export interface CargoSheet {
  /**
   * The ship, copied into the sheet rather than looked up.
   *
   * A haul is planned with the ship as it was when it was chosen: the overlay
   * then needs nothing but this file to draw its gauge — no ship list, no
   * network — and a capacity edited on the site mid-flight cannot move the
   * target under the pilot.
   */
  transportId: string;
  shipName: string;
  capacity: number;
  maxContainer: ContainerSize;
  /**
   * Number of the mission being filled: lines that name no mission of their
   * own join «Mission <missionCounter>».
   */
  missionCounter: number;
  lines: CargoLine[];
}

export const DEFAULT_CUSTOM_CAPACITY = 1000;

/** The ship a sheet is started with, as the picker hands it over. */
export interface SheetShip {
  id: string;
  name: string;
  capacity: number;
}

function newId(): string {
  // `randomUUID` is there in the webview; the fallback keeps a corrupted or
  // exotic environment from producing colliding ids.
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Rebuilds a line from stored data, dropping anything that makes no sense. */
function sanitizeLine(raw: unknown): CargoLine | null {
  if (!raw || typeof raw !== "object") return null;

  const line = raw as Record<string, unknown>;
  const volume = Number(line.volume);

  if (
    typeof line.id !== "string" ||
    !Number.isFinite(volume) ||
    volume <= 0 ||
    volume > MAX_VOLUME
  ) {
    return null;
  }

  const maxContainer =
    typeof line.maxContainer === "number" && isContainerSize(line.maxContainer)
      ? line.maxContainer
      : DEFAULT_MAX_CONTAINER;

  const sanitizedVolume = Math.floor(volume);

  return {
    id: line.id,
    destination: typeof line.destination === "string" ? line.destination : "",
    content: typeof line.content === "string" ? line.content : "",
    location: typeof line.location === "string" ? line.location : "",
    mission: typeof line.mission === "string" ? line.mission : "",
    volume: sanitizedVolume,
    maxContainer,
    // Recomputed rather than trusted: cheap, and it rules out counts left
    // stale by a hand-edited store.
    quantities: splitVolume(sanitizedVolume, maxContainer),
  };
}

function sanitizeSheet(raw: unknown): CargoSheet | null {
  if (!raw || typeof raw !== "object") return null;

  const sheet = raw as Record<string, unknown>;
  if (typeof sheet.transportId !== "string" || !sheet.transportId) return null;

  const capacity = Number(sheet.capacity);
  const missionCounter = Number(sheet.missionCounter);

  return {
    transportId: sheet.transportId,
    shipName: typeof sheet.shipName === "string" ? sheet.shipName : "Vaisseau",
    capacity:
      Number.isFinite(capacity) && capacity > 0
        ? Math.floor(capacity)
        : DEFAULT_CUSTOM_CAPACITY,
    maxContainer:
      typeof sheet.maxContainer === "number" && isContainerSize(sheet.maxContainer)
        ? sheet.maxContainer
        : DEFAULT_MAX_CONTAINER,
    missionCounter:
      Number.isInteger(missionCounter) && missionCounter >= FIRST_MISSION_COUNTER
        ? missionCounter
        : FIRST_MISSION_COUNTER,
    lines: Array.isArray(sheet.lines)
      ? sheet.lines
          .map(sanitizeLine)
          .filter((line): line is CargoLine => line !== null)
      : [],
  };
}

export async function readSheet(): Promise<CargoSheet | null> {
  return sanitizeSheet(await getStoredCargoSheet());
}

async function write(sheet: CargoSheet | null): Promise<void> {
  await setStoredCargoSheet(sheet);

  // Every window keeps its own copy, and the overlay is created at startup:
  // without this it would show the sheet as it was then, for as long as the
  // app runs.
  await emit(CARGO_EVENT);
}

/**
 * Applies `update` to the current sheet and stores the result. A sheet that
 * does not exist is left alone: starting one is a decision, made by choosing
 * a ship, not something a stray edit should do.
 */
async function mutate(
  update: (sheet: CargoSheet) => CargoSheet,
): Promise<CargoSheet | null> {
  const current = await readSheet();
  if (!current) return null;

  const next = update(current);

  // An update that changed nothing hands back the sheet it was given. Writing
  // it anyway would have every window re-read the store for no reason.
  if (next === current) return current;

  await write(next);

  return next;
}

/** Starts a sheet for `ship`, replacing any sheet already there. */
export async function startSheet(ship: SheetShip): Promise<CargoSheet> {
  const sheet: CargoSheet = {
    transportId: ship.id,
    shipName: ship.name,
    capacity: Math.max(1, Math.floor(ship.capacity)),
    maxContainer: DEFAULT_MAX_CONTAINER,
    missionCounter: FIRST_MISSION_COUNTER,
    lines: [],
  };

  await write(sheet);

  return sheet;
}

export async function closeSheet(): Promise<void> {
  await write(null);
}

/** Swaps the ship of a sheet in progress, keeping every line. */
export function setShip(ship: SheetShip): Promise<CargoSheet | null> {
  return mutate((sheet) => ({
    ...sheet,
    transportId: ship.id,
    shipName: ship.name,
    capacity: Math.max(1, Math.floor(ship.capacity)),
  }));
}

/** Changing the largest box re-splits every line: the counts must agree. */
export function setMaxContainer(
  maxContainer: ContainerSize,
): Promise<CargoSheet | null> {
  return mutate((sheet) => ({
    ...sheet,
    maxContainer,
    lines: sheet.lines.map((line) => ({
      ...line,
      maxContainer,
      quantities: splitVolume(line.volume, maxContainer),
    })),
  }));
}

/**
 * Appends parsed rows — typed by hand, pasted, or read from a capture.
 *
 * A row that names no mission joins the one being filled, which is what makes
 * several captures of the same contract land in the same block.
 */
export function addLines(
  lines: ParsedBulkLine[],
): Promise<CargoSheet | null> {
  return mutate((sheet) => ({
    ...sheet,
    lines: [
      ...sheet.lines,
      ...lines.map((line) => ({
        id: newId(),
        destination: line.destination,
        content: line.content,
        location: line.location,
        mission: line.mission.trim() || missionName(sheet.missionCounter),
        volume: line.volume,
        maxContainer: sheet.maxContainer,
        quantities: splitVolume(line.volume, sheet.maxContainer),
      })),
    ],
  }));
}

/**
 * Rewrites one line, in the same shape a line is added in.
 *
 * The volume decides the box counts, so they are re-split rather than carried
 * over — and clamped on the way in, because this ends up in a stored file that
 * outlives whichever form produced it.
 */
export function updateLine(
  id: string,
  edit: ParsedBulkLine,
): Promise<CargoSheet | null> {
  return mutate((sheet) => {
    const volume = Math.min(
      MAX_VOLUME,
      Math.max(1, Math.floor(Number(edit.volume) || 0)),
    );

    return {
      ...sheet,
      lines: sheet.lines.map((line) =>
        line.id === id
          ? {
              ...line,
              destination: edit.destination,
              content: edit.content,
              location: edit.location,
              mission: edit.mission.trim() || missionName(sheet.missionCounter),
              volume,
              maxContainer: sheet.maxContainer,
              quantities: splitVolume(volume, sheet.maxContainer),
            }
          : line,
      ),
    };
  });
}

export function removeLine(id: string): Promise<CargoSheet | null> {
  return mutate((sheet) => ({
    ...sheet,
    lines: sheet.lines.filter((line) => line.id !== id),
  }));
}

/**
 * Renames a whole mission block.
 *
 * Renaming onto a name already in use merges the two blocks — the sheet groups
 * by name, not by identity, so that is what it was already showing.
 *
 * Renaming the block being filled also advances the counter: the number it
 * carried is free again, and a line added afterwards should open a new block
 * rather than resurrect the name the user has just moved away from.
 */
export function renameMission(
  from: string,
  to: string,
): Promise<CargoSheet | null> {
  return mutate((sheet) => {
    const name = to.trim();
    if (name === "" || name === from) return sheet;

    const lines = sheet.lines.map((line) =>
      line.mission === from ? { ...line, mission: name } : line,
    );

    return {
      ...sheet,
      missionCounter:
        from === missionName(sheet.missionCounter)
          ? nextMissionCounter(sheet.missionCounter, lines)
          : sheet.missionCounter,
      lines,
    };
  });
}

export function removeMission(mission: string): Promise<CargoSheet | null> {
  return mutate((sheet) => ({
    ...sheet,
    lines: sheet.lines.filter((line) => line.mission !== mission),
  }));
}

/** Everything entered from now on belongs to the next mission. */
export function startNewMission(): Promise<CargoSheet | null> {
  return mutate((sheet) => ({
    ...sheet,
    missionCounter: nextMissionCounter(sheet.missionCounter, sheet.lines),
  }));
}
