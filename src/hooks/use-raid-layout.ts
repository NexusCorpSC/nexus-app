import { useCallback, useEffect, useState } from "react";
import { getRaidLayout, setRaidLayout } from "@/lib/settings";
import {
  DEFAULT_RAID_LAYOUT,
  canMove,
  inChosenOrder,
  movedBy,
  movedOnto,
  nextColumns,
  settledOrder,
  type RaidColumns,
  type RaidLayout,
} from "@/lib/raid-layout";
import type { Squad } from "@/types/nexus";

/**
 * The raid, arranged the way this player wants it — and only this player.
 *
 * Nothing here reaches the API. Both the column count and the order live in the
 * desktop store, so they survive a restart and travel nowhere: no rank is
 * needed to change them, and nobody else sees the change.
 *
 * The stored order belongs to one raid at a time. Reading it back for another
 * raid would name squads that are not there, so it is simply ignored — which
 * also means landing in a new raid opens on the server's order, seniority
 * first.
 */
export function useRaidLayout(raid: { id: string; squads: Squad[] } | null) {
  const [layout, setLayout] = useState<RaidLayout>(DEFAULT_RAID_LAYOUT);

  useEffect(() => {
    let gone = false;

    void getRaidLayout()
      .then((stored) => {
        if (!gone) setLayout(stored);
      })
      .catch((error) => {
        // The arrangement is a convenience: a store that will not open costs
        // one column and the server's order, not the raid.
        console.error("cannot read the raid layout", error);
      });

    return () => {
      gone = true;
    };
  }, []);

  /** Held for the raid on screen, and for no other. */
  const order = layout.raidId === raid?.id ? layout.order : [];

  const squads = raid ? inChosenOrder(raid.squads, order) : [];
  const ids = squads.map((squad) => squad.id);

  const remember = useCallback((next: RaidLayout) => {
    // Written through before the await: the arrangement is what the player is
    // looking at, and it must not wait on a disk.
    setLayout(next);
    void setRaidLayout(next).catch((error) => {
      console.error("cannot store the raid layout", error);
    });
  }, []);

  const arrange = useCallback(
    (nextIds: string[]) => {
      if (!raid) return;
      remember({ ...layout, raidId: raid.id, order: nextIds });
    },
    [layout, raid, remember],
  );

  return {
    columns: layout.columns,
    /** The squads of the raid, in the order this player put them. */
    squads,

    cycleColumns: () =>
      remember({ ...layout, columns: nextColumns(layout.columns) }),
    setColumns: (columns: RaidColumns) => remember({ ...layout, columns }),

    /** One place earlier or later. `false` when it is already at that end. */
    canMove: (squadId: string, delta: number) => canMove(ids, squadId, delta),
    move: (squadId: string, delta: number) =>
      arrange(movedBy(settledOrder(squads, ids), squadId, delta)),

    /** Dropped onto another squad: it takes that place. */
    dropOnto: (draggedId: string, targetId: string) =>
      arrange(movedOnto(settledOrder(squads, ids), draggedId, targetId)),
  };
}
