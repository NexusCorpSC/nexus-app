import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { translator } from "@/i18n/translate";
import { getMySquad } from "@/lib/api/squads";
import { notify } from "@/lib/notifications";
import { getSquadAutoDown } from "@/lib/settings";
import {
  enumName,
  GAME_EVENT,
  TELEMETRY_GAME_EVENT,
  type GameEvent,
  type GameEventKind,
} from "@/lib/telemetry";
import type { SquadMemberPatch, SquadView } from "@/types/nexus";

type PatchMember = {
  mutateAsync: (variables: {
    squadId: string;
    userId: string;
    patch: SquadMemberPatch;
  }) => Promise<unknown>;
};

/** Long enough to read over the game, short enough to be gone by the fight. */
const NOTICE_TIMEOUT_MS = 4_000;

/**
 * What a game event says about the player's row: downed or dead takes them
 * out — and «prêt» with it, as the row's own toggle does — and a spawn or a
 * respawn puts them back. Every other event says nothing.
 *
 * The game sends nothing when a downed player is revived: getting back up
 * stays a click on the row (or the radial menu), unless they respawn.
 */
export function statusFor(kind: GameEventKind | null): boolean | null {
  switch (kind) {
    case "downed":
    case "dead":
      return false;
    case "spawn":
    case "respawn":
      return true;
    default:
      return null;
  }
}

/**
 * Every squad of `view` that holds a row for `userId`, with that row's state:
 * the squad on screen and, for a raid's organiser, the other squads of the raid
 * they fight in. The player is one person in the game, down everywhere at once.
 */
function myRows(view: SquadView, userId: string) {
  const squads = [view.squad, ...(view.raid?.squads ?? [])];
  const seen = new Set<string>();
  const rows: { squadId: string; squadName: string; alive: boolean }[] = [];

  for (const squad of squads) {
    if (!squad || seen.has(squad.id)) continue;
    seen.add(squad.id);
    const me = squad.members.find((member) => member.userId === userId);
    if (me)
      rows.push({ squadId: squad.id, squadName: squad.name, alive: me.alive });
  }

  return rows;
}

/**
 * Marks the player «éliminé» in their squad when the game's telemetry says
 * they went down or died, and «actif» again when they spawn or respawn.
 *
 * Runs in the squad window, which holds the session and lives as long as the
 * app. One request per game event that matters, and only when the row does
 * not already say it: the stream sends these a handful of times a fight, so
 * nothing here is periodic. The view is read again before writing — the cache
 * of a hidden window can be minutes old — and the setting is read at that
 * moment too, so turning it off in another window takes effect at once.
 */
export function useTelemetrySquadStatus(
  current: string | null,
  userId: string | null,
  patchMember: PatchMember,
) {
  const patchRef = useRef(patchMember);
  const currentRef = useRef(current);
  useEffect(() => {
    patchRef.current = patchMember;
    currentRef.current = current;
  });

  useEffect(() => {
    if (!userId) return;

    let gone = false;
    let unlisten: UnlistenFn | null = null;
    // One event at a time: a respawn and the spawn that follows it must not
    // both read «éliminé» and both write «actif».
    let queue: Promise<void> = Promise.resolve();

    async function apply(alive: boolean) {
      if (!(await getSquadAutoDown())) return;

      const view = await getMySquad(currentRef.current);
      if (gone || !userId) return;

      const patch: SquadMemberPatch = alive
        ? { alive: true }
        : { alive: false, ready: false };

      for (const row of myRows(view, userId)) {
        if (row.alive === alive) continue;

        await patchRef.current.mutateAsync({
          squadId: row.squadId,
          userId,
          patch,
        });

        void notify({
          kind: alive ? "success" : "warning",
          title: translator("Squad.telemetry")(alive ? "alive" : "down", {
            name: row.squadName,
          }),
          body: translator("Squad.telemetry")("body"),
          timeoutMs: NOTICE_TIMEOUT_MS,
        });
      }
    }

    void listen<GameEvent>(TELEMETRY_GAME_EVENT, (event) => {
      const alive = statusFor(enumName(GAME_EVENT, event.payload?.kind));
      if (alive === null) return;

      queue = queue
        .then(() => apply(alive))
        .catch((error) => {
          console.error("cannot report the game state to the squad", error);
        });
    })
      .then((stop) => {
        if (gone) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        console.error("cannot follow the game events", error);
      });

    return () => {
      gone = true;
      unlisten?.();
    };
  }, [userId]);
}
