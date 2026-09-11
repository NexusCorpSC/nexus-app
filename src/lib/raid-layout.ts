/**
 * How one player lays the raid out on their own screen.
 *
 * Both halves are **personal**, and that is the whole design decision here: the
 * number of columns follows a window somebody resized, and the order squads
 * appear in follows what that player is watching — the squad they are escorting
 * first, the one they keep losing sight of next. Two raiders looking at the same
 * fifteen people have no reason to want the same arrangement, so none of this
 * travels: it is stored on the machine, beside the shortcuts and the opacity.
 *
 * Consequently there is no rank to hold: everyone arranges their own view, and
 * nothing they do here is visible to anybody else.
 */

/** What the picker cycles through. More than four would be legible on nothing. */
export const RAID_COLUMN_CHOICES = [1, 2, 3, 4] as const;

export type RaidColumns = (typeof RAID_COLUMN_CHOICES)[number];

export type RaidLayout = {
  columns: RaidColumns;
  /**
   * The raid `order` was chosen for.
   *
   * One raid at a time, so one order is kept rather than a map that would grow
   * a line per raid ever joined. Landing in another raid simply leaves the
   * stored order behind — it names squads that are not there.
   */
  raidId: string | null;
  /**
   * Squad ids, first shown first.
   *
   * Neither complete nor trustworthy: a squad linked since the last arrangement
   * is missing from it, one that left is still in it, and the file can be
   * hand-edited. Everything below treats it as a preference laid over the real
   * roster rather than as the roster.
   */
  order: string[];
};

export const DEFAULT_RAID_LAYOUT: RaidLayout = {
  columns: 1,
  raidId: null,
  order: [],
};

export function isRaidColumns(value: unknown): value is RaidColumns {
  return (RAID_COLUMN_CHOICES as readonly number[]).includes(value as number);
}

/** The next count the picker offers, wrapping round. */
export function nextColumns(columns: RaidColumns): RaidColumns {
  const at = RAID_COLUMN_CHOICES.indexOf(columns);
  return RAID_COLUMN_CHOICES[(at + 1) % RAID_COLUMN_CHOICES.length];
}

export function columnsLabel(columns: RaidColumns): string {
  return columns === 1 ? "Une colonne" : `${columns} colonnes`;
}

type Identified = { id: string };

/**
 * The squads, arranged.
 *
 * Whatever the stored order names comes first, in that order; everything else
 * keeps the order the server sent — which is seniority — behind it. So a squad
 * that has just joined appears at the end rather than at some arbitrary place,
 * and a stored id naming a squad that left is simply never matched.
 */
export function inChosenOrder<T extends Identified>(
  squads: T[],
  order: string[],
): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));

  // `sort` is stable, so the unranked keep the order they came in with.
  return [...squads].sort((a, b) => {
    const left = rank.get(a.id);
    const right = rank.get(b.id);

    if (left === undefined && right === undefined) return 0;
    if (left === undefined) return 1;
    if (right === undefined) return -1;

    return left - right;
  });
}

/**
 * The arrangement as it actually stands — the stored preference completed by
 * whatever it leaves out.
 *
 * What gets written back, so that the stored order is always the whole roster:
 * a partial one would make the next move ambiguous.
 */
export function settledOrder<T extends Identified>(
  squads: T[],
  order: string[],
): string[] {
  return inChosenOrder(squads, order).map((squad) => squad.id);
}

/** One place earlier (`-1`) or later (`+1`). At either end, nothing moves. */
export function movedBy(ids: string[], squadId: string, delta: number): string[] {
  const from = ids.indexOf(squadId);
  if (from === -1) return ids;

  const to = from + delta;
  if (to < 0 || to >= ids.length) return ids;

  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, squadId);
  return next;
}

/**
 * Dropped onto another squad: the dragged one takes that place, and the rest
 * close up behind it.
 *
 * The invariant, stated plainly because the `+ 1` below reads like an
 * off-by-one and is not: **afterwards the dragged squad sits at the index the
 * target used to occupy** — in both directions. Dropping the first onto the
 * third leaves it third; dropping the last onto the first leaves it first.
 *
 * That adjustment is what makes a forward drop move anything at all. Without
 * it, dropping a squad onto its immediate successor reinserts it exactly where
 * it was: the gesture would do nothing, which is the one outcome a drag must
 * never have.
 */
export function movedOnto(
  ids: string[],
  draggedId: string,
  targetId: string,
): string[] {
  if (draggedId === targetId) return ids;

  const from = ids.indexOf(draggedId);
  const onto = ids.indexOf(targetId);
  if (from === -1 || onto === -1) return ids;

  const next = [...ids];
  next.splice(from, 1);
  next.splice(next.indexOf(targetId) + (onto > from ? 1 : 0), 0, draggedId);
  return next;
}

/** Whether this squad can go any further in that direction. */
export function canMove(
  ids: string[],
  squadId: string,
  delta: number,
): boolean {
  const at = ids.indexOf(squadId);
  return at !== -1 && at + delta >= 0 && at + delta < ids.length;
}
