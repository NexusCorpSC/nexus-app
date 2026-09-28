import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { findBlueprintByName } from "@/lib/api/blueprints";
import {
  GAME_LOG_ADD_BLUEPRINT_EVENT,
  GAME_LOG_BLUEPRINT_EVENT,
  syncGameLog,
  type AddFromLog,
  type BlueprintReceived,
} from "@/lib/game-log";
import { notify } from "@/lib/notifications";
import { useAddBlueprint } from "@/hooks/use-blueprint-ownership";

/** Long enough to finish a fight before answering. */
const OFFER_TIMEOUT_MS = 30_000;

function isBlueprintReceived(value: unknown): value is BlueprintReceived {
  const candidate = value as Partial<BlueprintReceived> | null;
  return typeof candidate?.name === "string" && candidate.name.length > 0;
}

function isAddFromLog(value: unknown): value is AddFromLog {
  const candidate = value as Partial<AddFromLog> | null;
  return (
    typeof candidate?.blueprintId === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.slug === "string"
  );
}

/** Subscribes to a Tauri event for as long as the component is mounted. */
function useTauriEvent(event: string, handler: (payload: unknown) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let gone = false;

    void listen<unknown>(event, (message) => handlerRef.current(message.payload))
      .then((stop) => {
        if (gone) stop();
        else unlisten = stop;
      })
      .catch((error) => console.error(`cannot follow ${event}`, error));

    return () => {
      gone = true;
      unlisten?.();
    };
  }, [event]);
}

/**
 * What the game's log says, turned into something to do. Mounted once, by the
 * main window's shell: it is the window that holds the session, and it stays
 * alive — hidden — while the game has the screen.
 *
 * For now, one thing: a blueprint received in game is offered for «mes
 * blueprints», on a toast whose button adds it. Closing the toast is the «no».
 * A blueprint already owned is not offered, and nothing is added unasked.
 */
export function useGameLog(signedIn: boolean): void {
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;

  const add = useAddBlueprint();
  const addRef = useRef(add);
  addRef.current = add;

  // Rust cannot read the settings before a window has opened the store, so the
  // watcher starts when this one says so.
  useEffect(() => {
    void syncGameLog().catch((error) =>
      console.error("cannot follow the game log", error),
    );
  }, []);

  useTauriEvent(GAME_LOG_BLUEPRINT_EVENT, (payload) => {
    if (!isBlueprintReceived(payload)) return;
    void offer(payload.name, signedInRef.current);
  });

  useTauriEvent(GAME_LOG_ADD_BLUEPRINT_EVENT, (payload) => {
    if (!isAddFromLog(payload)) return;

    addRef.current.mutate(payload.blueprintId, {
      onSuccess: ({ changed }) => {
        void notify({
          kind: "success",
          title: changed ? "Blueprint ajouté" : "Blueprint déjà possédé",
          body: changed
            ? `${payload.name} fait maintenant partie de vos blueprints.`
            : `${payload.name} était déjà dans vos blueprints.`,
          route: `/blueprints/${encodeURIComponent(payload.slug)}`,
        });
      },
      onError: (error) => {
        void notify({
          kind: "error",
          title: "Ajout impossible",
          body: `${payload.name} n'a pas pu être ajouté : ${
            error instanceof Error ? error.message : "erreur inconnue"
          }`,
          route: `/blueprints/${encodeURIComponent(payload.slug)}`,
        });
      },
    });
  });
}

async function offer(name: string, signedIn: boolean): Promise<void> {
  if (!signedIn) {
    await notify({
      kind: "info",
      title: "Blueprint obtenu",
      body: `${name} — connectez-vous à Nexus pour l'ajouter à vos blueprints.`,
      route: "/settings?section=account",
    });
    return;
  }

  try {
    const blueprint = await findBlueprintByName(name);

    if (!blueprint) {
      await notify({
        kind: "warning",
        title: "Blueprint obtenu",
        body: `${name} n'est pas encore connu de Nexus : il ne peut pas être ajouté.`,
      });
      return;
    }

    // Nothing to ask: the account already says so.
    if (blueprint.owned) return;

    await notify({
      kind: "info",
      title: "Blueprint obtenu",
      body: `${blueprint.name} — l'ajouter à vos blueprints Nexus ?`,
      timeoutMs: OFFER_TIMEOUT_MS,
      action: {
        label: "Ajouter",
        event: GAME_LOG_ADD_BLUEPRINT_EVENT,
        payload: {
          blueprintId: blueprint.id,
          name: blueprint.name,
          slug: blueprint.slug,
        } satisfies AddFromLog,
      },
      route: `/blueprints/${encodeURIComponent(blueprint.slug)}`,
    });
  } catch (error) {
    console.error("cannot look up a blueprint from the game log", error);
    await notify({
      kind: "error",
      title: "Blueprint obtenu",
      body: `${name} n'a pas pu être recherché sur Nexus.`,
    });
  }
}
