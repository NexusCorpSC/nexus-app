import { useEffect, useMemo, useRef } from "react";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { notify } from "@/lib/notifications";
import {
  RADIAL_SQUAD_ACTION_EVENT,
  RADIAL_SQUAD_EVENT,
  RADIAL_SQUAD_REQUEST_EVENT,
  RADIAL_WINDOW,
  type RadialSquad,
  type RadialSquadAction,
} from "@/lib/radial";
import type { Squad, SquadMemberPatch } from "@/types/nexus";

type PatchMember = {
  mutate: (variables: {
    squadId: string;
    userId: string;
    patch: SquadMemberPatch;
  }) => void;
};

/** Long enough to see the gesture took, short enough to be gone by the next. */
const CONFIRMATION_TIMEOUT_MS = 2_500;

/**
 * The reader's row, as the radial menu draws it: `null` outside a squad, and
 * in a squad the reader has no row in — an organiser looking at one of the
 * raid's other squads.
 */
function radialSquad(
  squad: Squad | null | undefined,
  userId: string | null,
): RadialSquad | null {
  if (!squad || !userId) return null;

  const me = squad.members.find((member) => member.userId === userId);
  if (!me) return null;

  return {
    squadId: squad.id,
    squadName: squad.name,
    // Down takes ready with it, as the member row reads it.
    ready: me.ready && me.alive,
    alive: me.alive,
    readyCount: squad.members.filter((member) => member.ready && member.alive)
      .length,
    total: squad.members.length,
  };
}

/**
 * Serves the radial menu from the squad window.
 *
 * Tells the menu the reader's row whenever it changes, and again whenever the
 * menu asks — it is created hidden at startup, maybe after this window. Takes
 * back the two squad actions the menu offers and writes them on the reader's
 * row, through the same mutation as the row's own toggles, so the overlay
 * lights up at once and the stream cannot undo it.
 */
export function useRadialBridge(
  squad: Squad | null | undefined,
  userId: string | null,
  patchMember: PatchMember,
) {
  const mine = radialSquad(squad, userId);
  // Compared by value: the squad object is replaced by every push, and the menu
  // only needs telling when something it draws changed.
  const signature = JSON.stringify(mine);
  const current = useMemo<RadialSquad | null>(
    () => JSON.parse(signature),
    [signature],
  );

  const squadRef = useRef(squad);
  const currentRef = useRef(current);
  const patchRef = useRef(patchMember);
  useEffect(() => {
    squadRef.current = squad;
    currentRef.current = current;
    patchRef.current = patchMember;
  });

  useEffect(() => {
    void emitTo(RADIAL_WINDOW, RADIAL_SQUAD_EVENT, current).catch((error) => {
      console.error("cannot tell the radial menu about the squad", error);
    });
  }, [current]);

  useEffect(() => {
    const stops: UnlistenFn[] = [];
    let gone = false;

    const keep = (stop: UnlistenFn) => {
      if (gone) stop();
      else stops.push(stop);
    };

    void listen(RADIAL_SQUAD_REQUEST_EVENT, () => {
      void emitTo(RADIAL_WINDOW, RADIAL_SQUAD_EVENT, currentRef.current);
    })
      .then(keep)
      .catch((error) => {
        console.error("cannot answer the radial menu", error);
      });

    void listen<RadialSquadAction>(RADIAL_SQUAD_ACTION_EVENT, (event) => {
      const squad = squadRef.current;
      const { action, squadId } = event.payload ?? {};

      // Read from what this window holds now, not from what the menu drew:
      // this is the truth, and a squad switched meanwhile is not the one the
      // gesture was meant for.
      if (!squad || !userId || squad.id !== squadId) return;

      const me = squad.members.find((member) => member.userId === userId);
      if (!me) return;

      if (action === "ready") {
        // Down, «prêt» is refused — the row's toggle does the same.
        if (!me.alive) return;

        const ready = !me.ready;
        patchRef.current.mutate({ squadId, userId, patch: { ready } });
        void notify({
          kind: ready ? "success" : "info",
          title: ready ? "READY" : "NOT READY",
          body: squad.name,
          timeoutMs: CONFIRMATION_TIMEOUT_MS,
        });
        return;
      }

      if (action === "alive") {
        // Falling takes «prêt» in the same patch, as the row does.
        const patch: SquadMemberPatch = me.alive
          ? { alive: false, ready: false }
          : { alive: true };
        patchRef.current.mutate({ squadId, userId, patch });
        void notify({
          kind: me.alive ? "warning" : "success",
          title: me.alive ? "Éliminé" : "Actif",
          body: squad.name,
          timeoutMs: CONFIRMATION_TIMEOUT_MS,
        });
      }
    })
      .then(keep)
      .catch((error) => {
        console.error("cannot follow the radial menu", error);
      });

    return () => {
      gone = true;
      stops.forEach((stop) => stop());
    };
  }, [userId]);
}
