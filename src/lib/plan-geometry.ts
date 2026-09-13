import { PLAN_GRID } from "@/types/nexus";

/**
 * Turning what a pointer did into what gets stored.
 *
 * The same shape as `app/squads/plans/simplify.ts` on the site, and
 * hand-mirrored the way the types are: it is a pure function with no protocol
 * meaning — a different epsilon only means a slightly different point count, so
 * the two drifting apart costs nothing.
 *
 * Coordinates are integers on the plan's grid, which is what makes a plan drawn
 * on a desktop the same plan when it is read here over a cockpit.
 */

/** Grid units a point may sit off the line between its neighbours. */
const EPSILON = 6;

/** Pairs, after simplification. The API refuses more. */
const MAX_POINTS = 256;

function sqDistanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;

  if (dx === 0 && dy === 0) return (px - ax) ** 2 + (py - ay) ** 2;

  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)),
  );

  return (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
}

/** Ramer–Douglas–Peucker, iteratively: a fast trace is deep enough to matter. */
function rdp(points: number[], epsilon: number): number[] {
  const pairs = points.length / 2;
  if (pairs < 3) return points;

  const keep = new Uint8Array(pairs);
  keep[0] = 1;
  keep[pairs - 1] = 1;

  const stack: [number, number][] = [[0, pairs - 1]];
  const squared = epsilon * epsilon;

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last - first < 2) continue;

    let worst = 0;
    let at = -1;

    for (let index = first + 1; index < last; index += 1) {
      const distance = sqDistanceToSegment(
        points[index * 2],
        points[index * 2 + 1],
        points[first * 2],
        points[first * 2 + 1],
        points[last * 2],
        points[last * 2 + 1],
      );

      if (distance > worst) {
        worst = distance;
        at = index;
      }
    }

    if (at !== -1 && worst > squared) {
      keep[at] = 1;
      stack.push([first, at], [at, last]);
    }
  }

  const kept: number[] = [];

  for (let index = 0; index < pairs; index += 1) {
    if (keep[index]) kept.push(points[index * 2], points[index * 2 + 1]);
  }

  return kept;
}

/** Drop every other point until the trace fits. Coarser beats refused. */
function thin(points: number[]): number[] {
  let kept = points;

  while (kept.length > MAX_POINTS * 2) {
    const thinner: number[] = [kept[0], kept[1]];

    for (let index = 2; index < kept.length / 2 - 1; index += 2) {
      thinner.push(kept[index * 2], kept[index * 2 + 1]);
    }

    thinner.push(kept[kept.length - 2], kept[kept.length - 1]);
    kept = thinner;
  }

  return kept;
}

export function toGrid(value: number): number {
  return Math.max(0, Math.min(PLAN_GRID, Math.round(value)));
}

/** The trace as it will be stored: simplified, thinned if it must be, on the grid. */
export function forStorage(points: number[]): number[] {
  return thin(rdp(points.map(toGrid), EPSILON));
}

/** The `d` of a polyline through a flat `[x, y, …]`. */
export function pathOf(points: number[]): string {
  if (points.length < 2) return "";

  let d = `M ${points[0]} ${points[1]}`;

  for (let index = 2; index < points.length; index += 2) {
    d += ` L ${points[index]} ${points[index + 1]}`;
  }

  return d;
}

/** The background, fitted inside the square grid rather than stretching it. */
export function fitBackground(background: { width: number; height: number }) {
  const ratio = background.width / background.height;

  const width = ratio >= 1 ? PLAN_GRID : PLAN_GRID * ratio;
  const height = ratio >= 1 ? PLAN_GRID / ratio : PLAN_GRID;

  return {
    x: (PLAN_GRID - width) / 2,
    y: (PLAN_GRID - height) / 2,
    width,
    height,
  };
}
