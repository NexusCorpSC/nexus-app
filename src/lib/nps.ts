import type { NpsBody, NpsPlace, PlacePosition } from "@/types/nexus";

/**
 * The geometry of the NPS — Nexus Positioning System.
 *
 * `/showlocation` gives the player's position in the frame of the star
 * system, centred on its star. That frame does not move, but planets and
 * moons turn on themselves, and everything near one turns with it: an outpost
 * never has the same system position twice. So a place on a body is stored in
 * that body's frame with the rotation undone, where it stays put, and turned
 * back into the system frame at the moment of each reading.
 *
 * The rotation model is the one of the community navigation tool by Valalol
 * (MIT): a body turns at a constant rate, and its angle on 2020-01-01 00:00
 * UTC — `rotationAdjust` — pins it to the clock. A slightly wrong constant
 * shifts every place of that body by the same angle, recorded and read back
 * through the same model: distances between places stay right. The bodies'
 * values themselves come from starmap.space, through the site.
 *
 * Coordinates are metres throughout; angles are degrees at the edges.
 */

/**
 * One reading of the player's position, stamped with when it was seen: from
 * `/showlocation`, or read off the screen from the game's debug lines.
 */
export type Fix = {
  x: number;
  y: number;
  z: number;
  /** Milliseconds since the Unix epoch. */
  at: number;
  source?: "clipboard" | "screen";
  /**
   * The other zones `r_displayInfo` showed, innermost first, letters only
   * (`jumppointnyxcastra`): see `src-tauri/src/nps_screen.rs`.
   */
  zones?: string[];
};

type Vector = { x: number; y: number; z: number };

const EPOCH_MS = Date.UTC(2020, 0, 1);

/** Under this, two readings are the same spot: no direction of travel. */
export const MIN_TRAVEL_M = 20;

/** Past this, a reading says nothing about where one is heading now. */
export const MAX_TRAVEL_AGE_MS = 10 * 60 * 1000;

/** Under this, in metres a second, one is neither closing in nor moving away. */
export const MIN_CLOSING_SPEED = 0.5;

/**
 * Under this, two readings are too close in time to give a direction: read
 * off the screen every second, the noise of a step would swing it about.
 */
export const MIN_TRAVEL_GAP_MS = 2000;

const DEG = Math.PI / 180;

function sub(a: Vector, b: Vector): Vector {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: Vector, b: Vector): Vector {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function length(v: Vector): number {
  return Math.hypot(v.x, v.y, v.z);
}

function dot(a: Vector, b: Vector): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Turns `v` by `angle` radians around the body's axis, `z`. */
function rotateZ(v: Vector, angle: number): Vector {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos, z: v.z };
}

/** How far `body` has turned at `at`, in radians. */
function rotation(body: NpsBody, at: number): number {
  const degreesPerSecond =
    body.rotationHours > 0 ? 360 / (body.rotationHours * 3600) : 0;
  const degrees =
    (degreesPerSecond * ((at - EPOCH_MS) / 1000) + body.rotationAdjust) % 360;
  return degrees * DEG;
}

/**
 * The body one is on or near, if any: the nearest centre among those whose
 * turning zone holds the point.
 */
export function bodyAt(point: Vector, bodies: NpsBody[]): NpsBody | null {
  let found: NpsBody | null = null;
  let best = Infinity;
  for (const body of bodies) {
    const distance = length(sub(point, body));
    if (distance <= body.zoneRadius && distance < best) {
      found = body;
      best = distance;
    }
  }
  return found;
}

/** A system-frame reading, in the frame of `body`, rotation undone. */
export function toBodyFrame(fix: Fix, body: NpsBody): Vector {
  return rotateZ(sub(fix, body), -rotation(body, fix.at));
}

/** A point of `body`'s frame, in the system frame at `at`. */
export function toSystemFrame(
  local: Vector,
  body: NpsBody,
  at: number,
): Vector {
  return add(rotateZ(local, rotation(body, at)), body);
}

/** Where the player stands, as the site stores a place's position. */
export function positionOf(fix: Fix, bodies: NpsBody[]): PlacePosition {
  const body = bodyAt(fix, bodies);
  if (!body) return { x: fix.x, y: fix.y, z: fix.z };
  const local = toBodyFrame(fix, body);
  return { body: body.slug, x: local.x, y: local.y, z: local.z };
}

/**
 * A stored position, in the system frame at `at`; `null` when its body is not
 * one the site describes any more.
 */
export function systemPositionOf(
  position: PlacePosition,
  bodies: NpsBody[],
  at: number,
): Vector | null {
  if (!position.body) return position;
  const body = bodies.find((one) => one.slug === position.body);
  return body ? toSystemFrame(position, body, at) : null;
}

export type Geo = {
  /** Degrees, north positive. */
  latitude: number;
  /** Degrees, east positive, in (-180, 180]. */
  longitude: number;
  /** Metres above the ground's radius. */
  altitude: number;
};

/** Latitude, longitude and altitude of a point of a body's frame. */
export function geoOf(local: Vector, body: NpsBody): Geo {
  const radius = length(local);
  return {
    latitude: radius > 0 ? Math.asin(local.z / radius) / DEG : 0,
    longitude: Math.atan2(local.y, local.x) / DEG,
    altitude: radius - body.radius,
  };
}

/** The point of a body's frame at a latitude, longitude and altitude. */
export function fromGeo(geo: Geo, body: NpsBody): Vector {
  const radius = body.radius + geo.altitude;
  const phi = geo.latitude * DEG;
  const lambda = geo.longitude * DEG;
  return {
    x: radius * Math.cos(phi) * Math.cos(lambda),
    y: radius * Math.cos(phi) * Math.sin(lambda),
    z: radius * Math.sin(phi),
  };
}

/**
 * A number as a player types it: `12 850,5`, `12850.5`, `12,850.5` or
 * `12.850,5`. With both a comma and a point, the last one is the decimal
 * separator and the other groups thousands; with a comma alone, it is the
 * decimal separator.
 */
export function parseNumber(text: string): number | null {
  let cleaned = text.trim().replace(/[\s\u00a0\u202f']/g, "");
  if (!cleaned) return null;
  const comma = cleaned.lastIndexOf(",");
  const point = cleaned.lastIndexOf(".");
  cleaned =
    comma > point
      ? cleaned.replace(/\./g, "").replace(/,/g, ".")
      : cleaned.replace(/,/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** As `src-tauri/src/nps.rs` reads them, exponent included. */
const NUMBER = String.raw`-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?`;

/** The line `/showlocation` copies, in metres. */
const SHOWLOCATION = new RegExp(
  String.raw`^\s*coordinates:\s*x:\s*(${NUMBER})\s+y:\s*(${NUMBER})\s+z:\s*(${NUMBER})`,
  "im",
);

/** The `Zone: … Pos:` lines of `r_displayInfo`, each value with its unit. */
const ZONE_LINE = new RegExp(
  String.raw`zone:\s*(\S+)\s+pos:\s*` +
    [1, 2, 3]
      .map(() => String.raw`(${NUMBER})\s*(k?m)\b`)
      .join(String.raw`\s+`),
  "gi",
);

/** The zone of a `ZONE_LINE` match, and its position in metres. */
function zoneLines(text: string): { zone: string; point: Vector }[] {
  return [...text.matchAll(ZONE_LINE)].flatMap((line) => {
    const [x, y, z] = [0, 1, 2].map(
      (index) =>
        Number(line[2 + index * 2]) *
        (line[3 + index * 2].toLowerCase() === "km" ? 1000 : 1),
    );
    return [x, y, z].every(Number.isFinite)
      ? [{ zone: squash(line[1]), point: { x, y, z } }]
      : [];
  });
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Coordinates pasted from the game, in metres: the line `/showlocation`
 * copies or the `Zone: SolarSystem_… Pos:` line `r_displayInfo` shows. The
 * `Root` and `CamPos` lines are left out, as in `src-tauri/src/nps_screen.rs`:
 * in Pyro, `Root` is in another frame.
 */
export function parseGameCoordinates(text: string): Vector | null {
  const showlocation = SHOWLOCATION.exec(text);
  if (showlocation) {
    const [x, y, z] = showlocation.slice(1, 4).map(Number);
    return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
  }
  return (
    zoneLines(text).find((line) => line.zone.startsWith("solarsystem"))
      ?.point ?? null
  );
}

const ROMAN: Record<string, number> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
};

/** How a body's zone ends: `Daymar` → `daymar`, `Pyro IV` → `pyro4`. */
function zoneSuffix(name: string): string {
  return squash(
    name.replace(/\b([ivx]+)\b/gi, (roman) =>
      String(ROMAN[roman.toLowerCase()] ?? roman),
    ),
  );
}

/**
 * The system a reading names, among `systems` (slugs): coordinates alone do
 * not tell Stanton from Nyx, each centred on its own star, but the zones
 * `r_displayInfo` shows do (`Hangar_…_RestStop_Nyx_…`, `jumppoint_nyx_castra`,
 * `OOC_Stanton_2b_Daymar`). The innermost zone that names one decides, and
 * in it the name that comes first: a jump point is named after its own system,
 * then the one it leads to.
 */
export function systemOfZones(
  zones: string[] | undefined,
  systems: string[],
): string | null {
  const keys = systems
    .map((slug) => ({ slug, key: squash(slug) }))
    .filter(({ key }) => key.length >= 3);
  for (const zone of zones ?? []) {
    let found: { slug: string; at: number } | null = null;
    for (const { slug, key } of keys) {
      const at = zone.indexOf(key);
      if (at >= 0 && (!found || at < found.at)) found = { slug, at };
    }
    if (found) return found.slug;
  }
  return null;
}

/** Whether pasted text looks like coordinates from the game at all. */
export function looksLikeGameCoordinates(text: string): boolean {
  return /\b(zone|coordinates)\s*:/i.test(text);
}

/**
 * The position in a planet's or a moon's own frame, from the line
 * `r_displayInfo` shows for it (`Zone: OOC_Stanton_2b_Daymar Pos: … km …`),
 * in metres, with the body the zone ends with. Lines of other zones (the
 * system, a hangar, a Lagrange point…) are not in a body's frame: left out.
 * Bodies of `system` are tried first, then the longest names.
 */
export function parseBodyCoordinates(
  text: string,
  bodies: NpsBody[],
  system: string | null,
): { point: Vector; body: NpsBody } | null {
  const ranked = [...bodies].sort(
    (a, b) =>
      Number(b.systemSlug === system) - Number(a.systemSlug === system) ||
      b.name.length - a.name.length,
  );
  for (const { zone, point } of zoneLines(text)) {
    if (!zone.startsWith("ooc")) continue;
    const body = ranked.find((one) => {
      const suffix = zoneSuffix(one.name);
      return suffix && zone.endsWith(suffix);
    });
    if (body) return { point, body };
  }
  return null;
}

function normalize360(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** Into (-180, 180]: negative to the left, positive to the right. */
function normalize180(degrees: number): number {
  const turned = normalize360(degrees);
  return turned > 180 ? turned - 360 : turned;
}

/**
 * The compass bearing from one point of a body to another, along the great
 * circle — what one would follow flying low. North is 0°, east 90°.
 */
function bearing(from: Vector, to: Vector, body: NpsBody): number {
  const a = geoOf(from, body);
  const b = geoOf(to, body);
  const phi1 = a.latitude * DEG;
  const phi2 = b.latitude * DEG;
  const dLambda = (b.longitude - a.longitude) * DEG;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return normalize360(Math.atan2(y, x) / DEG);
}

/** Over the ground, at the ground's radius. */
function surfaceDistance(from: Vector, to: Vector, body: NpsBody): number {
  const cosine = dot(from, to) / (length(from) * length(to) || 1);
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * body.radius;
}

/** What the overlay shows about a destination. */
export type Guidance = {
  /** In a straight line, in metres. */
  distance: number;
  /** Both on the same body: over the ground, and the bearing to follow. */
  surface?: { distance: number; heading: number };
  /**
   * The destination relative to the direction of travel since the previous
   * reading, in degrees: on a body, signed — negative is to the left; in
   * space, how far off course, unsigned, since nothing says which side.
   */
  turn?: { degrees: number; signed: boolean };
  /** Metres a second closer since the previous reading; negative: farther. */
  closingSpeed?: number;
  /** Seconds to arrival at that speed, when getting closer. */
  eta?: number;
};

/** Distance, bearing and turn to `target`, from the latest reading. */
export function guide(
  current: Fix,
  previous: Fix | null,
  target: PlacePosition,
  bodies: NpsBody[],
): Guidance | null {
  const here = systemPositionOf(target, bodies, current.at);
  if (!here) return null;
  const guidance: Guidance = { distance: length(sub(here, current)) };

  const body = bodyAt(current, bodies);
  const sameBody = Boolean(body && target.body === body.slug);
  const local = body ? toBodyFrame(current, body) : null;
  if (body && local && sameBody) {
    guidance.surface = {
      distance: surfaceDistance(local, target, body),
      heading: bearing(local, target, body),
    };
  }

  const usable =
    previous &&
    current.at > previous.at &&
    current.at - previous.at <= MAX_TRAVEL_AGE_MS;
  if (!previous || !usable) return guidance;

  const there = systemPositionOf(target, bodies, previous.at);
  if (there) {
    const before = length(sub(there, previous));
    const seconds = (current.at - previous.at) / 1000;
    const speed = (before - guidance.distance) / seconds;
    guidance.closingSpeed = speed;
    if (speed > MIN_CLOSING_SPEED) guidance.eta = guidance.distance / speed;
  }

  if (body && local && sameBody && bodyAt(previous, bodies) === body) {
    // Both readings in the body's frame: the ground track, which is what a
    // heading means near a planet.
    const start = toBodyFrame(previous, body);
    if (length(sub(local, start)) >= MIN_TRAVEL_M) {
      guidance.turn = {
        degrees: normalize180(
          guidance.surface!.heading - bearing(start, local, body),
        ),
        signed: true,
      };
    }
  } else if (!body && !bodyAt(previous, bodies)) {
    const travel = sub(current, previous);
    const toward = sub(here, current);
    if (length(travel) >= MIN_TRAVEL_M && length(toward) > 0) {
      const cosine = dot(travel, toward) / (length(travel) * length(toward));
      guidance.turn = {
        degrees: Math.acos(Math.max(-1, Math.min(1, cosine))) / DEG,
        signed: false,
      };
    }
  }

  return guidance;
}

/**
 * Whether a place can be reached from `system`: each system has its own frame,
 * centred on its star, so coordinates from two of them do not compare. An
 * unknown side does not rule anything out.
 */
export function inSystem(
  place: { systemSlug?: string },
  system: string | null,
): boolean {
  return !place.systemSlug || !system || place.systemSlug === system;
}

/** The recorded places of `system` nearest to a reading, closest first. */
export function nearestPlaces(
  fix: Fix,
  places: NpsPlace[],
  bodies: NpsBody[],
  system: string | null,
  count: number,
): { place: NpsPlace; distance: number }[] {
  return places
    .filter((place) => inSystem(place, system))
    .flatMap((place) => {
      const point = systemPositionOf(place.position, bodies, fix.at);
      return point ? [{ place, distance: length(sub(point, fix)) }] : [];
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count);
}

/** The eight compass points, by their key in `NpsOverlay.compass`. */
export const COMPASS_POINTS = [
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
  "nw",
] as const;

export type CompassPoint = (typeof COMPASS_POINTS)[number];

export function compassPoint(heading: number): CompassPoint {
  return COMPASS_POINTS[Math.round(normalize360(heading) / 45) % 8];
}

/**
 * The reading to measure the way one is going from, among the earlier ones
 * (oldest first, `current` last or not in it): the latest one far enough
 * behind, in space and in time. Read off the screen every second, the one
 * just before is a step away and says nothing; with readings by hand, it is
 * simply the one before. Falls back on the one before when none is far
 * enough: the overlay then says to move on.
 */
export function previousFor(
  current: Fix,
  history: Fix[],
  bodies: NpsBody[],
): Fix | null {
  const earlier = history.filter(
    (one) => one.at < current.at && current.at - one.at <= MAX_TRAVEL_AGE_MS,
  );
  if (earlier.length === 0) return null;

  const body = bodyAt(current, bodies);
  const here = body ? toBodyFrame(current, body) : current;
  for (let index = earlier.length - 1; index >= 0; index -= 1) {
    const one = earlier[index];
    if (current.at - one.at < MIN_TRAVEL_GAP_MS) continue;
    const there = body ? toBodyFrame(one, body) : one;
    if (length(sub(here, there)) >= MIN_TRAVEL_M) return one;
  }
  return earlier[earlier.length - 1];
}

/** What `formatDistance` needs of `useFormatter()`. */
type NumberFormatter = {
  number: (value: number, options?: Intl.NumberFormatOptions) => string;
};

/** As the game writes distances: metres, kilometres, then Mm and Gm. */
export function formatDistance(
  meters: number,
  format: NumberFormatter,
): string {
  const abs = Math.abs(meters);
  const [value, unit, digits] =
    abs < 1_000
      ? [meters, "m", 0]
      : abs < 100_000
        ? [meters / 1_000, "km", 1]
        : abs < 10_000_000
          ? [meters / 1_000, "km", 0]
          : abs < 1_000_000_000
            ? [meters / 1_000_000, "Mm", 1]
            : [meters / 1_000_000_000, "Gm", 2];
  return `${format.number(value, { maximumFractionDigits: digits })} ${unit}`;
}
