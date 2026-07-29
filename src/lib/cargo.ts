/**
 * Cargo sheet domain logic, mirroring `lib/cargo.ts` in nexus-tools.
 *
 * Splits a volume in SCU into the standard Star Citizen container sizes, so a
 * hauler knows how many boxes of each size to load. Deliberately a copy rather
 * than a shared package: the sheet is offline, and the two clients only have
 * to agree on what a manifest *is*, not on how it is stored.
 */

export const CONTAINER_SIZES = [32, 24, 16, 8, 4, 2, 1] as const;

export type ContainerSize = (typeof CONTAINER_SIZES)[number];

export interface Transport {
  id: string;
  name: string;
  capacity: number;
}

/** Used until `/api/cargo-ships` has been read once, and if it never can be. */
export const DEFAULT_TRANSPORTS: Transport[] = [
  { id: "hull-b", name: "Hull B", capacity: 512 },
  { id: "railen", name: "Railen", capacity: 640 },
  { id: "ironclad", name: "Ironclad", capacity: 2160 },
];

/** Pseudo transport letting the user type an arbitrary capacity. */
export const CUSTOM_TRANSPORT_ID = "custom";

export const DEFAULT_TRANSPORT_ID = "ironclad";
export const DEFAULT_MAX_CONTAINER: ContainerSize = 16;

/** Below this many SCU left, the remaining capacity is flagged as tight. */
export const LOW_CAPACITY_THRESHOLD = 50;

export const MAX_VOLUME = 100_000;

export interface CargoLine {
  id: string;
  destination: string;
  content: string;
  /** Where the cargo sits: pad, hangar, station… */
  location: string;
  /** Groups rows in the table; empty means the line joins no mission. */
  mission: string;
  volume: number;
  /** Largest container size allowed when this line was computed. */
  maxContainer: ContainerSize;
  /** Container counts, aligned with `CONTAINER_SIZES`. */
  quantities: number[];
}

export function emptyQuantities(): number[] {
  return CONTAINER_SIZES.map(() => 0);
}

export function isContainerSize(value: number): value is ContainerSize {
  return (CONTAINER_SIZES as readonly number[]).includes(value);
}

export function findTransport(
  transports: Transport[],
  id: string,
): Transport | undefined {
  return transports.find((transport) => transport.id === id);
}

/**
 * Greedily fills the largest allowed containers first. Because 1 SCU is one of
 * the sizes, the decomposition is always exact for a positive integer volume.
 */
export function splitVolume(volume: number, maxContainer: number): number[] {
  let remaining = Math.max(0, Math.floor(volume));

  return CONTAINER_SIZES.map((size) => {
    if (size > maxContainer) return 0;

    const count = Math.floor(remaining / size);
    remaining -= count * size;
    return count;
  });
}

export function sumQuantities(lines: CargoLine[]): number[] {
  return lines.reduce<number[]>((totals, line) => {
    line.quantities.forEach((quantity, index) => {
      totals[index] += quantity;
    });
    return totals;
  }, emptyQuantities());
}

export function totalVolume(lines: CargoLine[]): number {
  return lines.reduce((total, line) => total + line.volume, 0);
}

/** Total number of physical boxes, all sizes combined. */
export function containerCount(quantities: number[]): number {
  return quantities.reduce((total, quantity) => total + quantity, 0);
}

export interface MissionGroup {
  mission: string;
  lines: CargoLine[];
  volume: number;
  quantities: number[];
}

/**
 * One block per mission, in order of first appearance. Lines with no mission
 * gather in a single trailing group keyed by the empty string.
 */
export function groupByMission(lines: CargoLine[]): MissionGroup[] {
  const groups = new Map<string, CargoLine[]>();

  for (const line of lines) {
    const existing = groups.get(line.mission);
    if (existing) existing.push(line);
    else groups.set(line.mission, [line]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return 0;
    })
    .map(([mission, groupLines]) => ({
      mission,
      lines: groupLines,
      volume: totalVolume(groupLines),
      quantities: sumQuantities(groupLines),
    }));
}

export const FIRST_MISSION_COUNTER = 1;

/**
 * Name given to entries that carry no mission of their own. Plain data, not a
 * label: it is stored in the sheet as typed.
 */
export function missionName(counter: number): string {
  return `Mission ${counter}`;
}

/**
 * Next counter for the «new mission» button, skipping numbers already in use
 * so a fresh mission never lands in an existing block.
 */
export function nextMissionCounter(
  counter: number,
  lines: CargoLine[],
): number {
  const used = new Set(lines.map((line) => line.mission));
  let next = counter + 1;

  while (used.has(missionName(next))) next += 1;

  return next;
}

export interface ParsedBulkLine {
  destination: string;
  content: string;
  volume: number;
  location: string;
  mission: string;
}

/**
 * Parses one row: `Destination;Contenu;Volume;Emplacement[;Mission]`. Returns
 * null on a malformed row so the caller can report it rather than guess.
 */
export function parseBulkLine(raw: string): ParsedBulkLine | null {
  const parts = raw.split(";").map((part) => part.trim());

  if (parts.length < 4) return null;

  const [destination, content, volumeRaw, location] = parts;
  const mission = parts[4] ?? "";

  if (!destination || !volumeRaw) return null;

  const volume = Number(volumeRaw.replace(",", "."));
  if (!Number.isFinite(volume)) return null;

  const rounded = Math.floor(volume);
  if (rounded <= 0 || rounded > MAX_VOLUME) return null;

  return { destination, content, volume: rounded, location, mission };
}

export interface BulkParseResult {
  parsed: ParsedBulkLine[];
  invalid: string[];
}

export function parseBulk(raw: string): BulkParseResult {
  const parsed: ParsedBulkLine[] = [];
  const invalid: string[] = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const line = parseBulkLine(trimmed);
    if (line) parsed.push(line);
    else invalid.push(trimmed);
  }

  return { parsed, invalid };
}
