import { useEffect } from "react";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addBlueprintToMine,
  removeBlueprintFromMine,
  type BlueprintOwnership,
} from "@/lib/api/blueprints";

/**
 * Announces a change of possession to every window.
 *
 * Each window is its own React tree with its own query cache, and the client
 * does not refetch on focus, so a blueprint added from the search palette would
 * otherwise still read «Non possédé» in the main window for as long as it stays
 * open. Same idea as `CARGO_EVENT`.
 *
 * Emitted whatever the call reported, «it was already like that» included: the
 * event reads «someone has just asserted a possession, read it again», and a
 * window showing the opposite is exactly the one that needs telling.
 */
export const BLUEPRINT_OWNED_EVENT = "blueprints://owned";

/** Drops every cached view of blueprint possession in this window. */
function invalidate(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: ["blueprints"] });
  void queryClient.invalidateQueries({ queryKey: ["blueprint"] });
}

function useOwnershipMutation(
  call: (blueprintId: string) => Promise<BlueprintOwnership>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: call,
    onSuccess: () => {
      invalidate(queryClient);
      void emit(BLUEPRINT_OWNED_EVENT);
    },
  });
}

/**
 * Adds a blueprint to «mes blueprints», from wherever one is shown.
 *
 * The mutation carries the whole outcome: `added` tells an already-owned
 * blueprint from a freshly added one, which the search palette needs since a
 * result says nothing about possession.
 */
export function useAddBlueprint() {
  return useOwnershipMutation(addBlueprintToMine);
}

/** Drops a blueprint from «mes blueprints». */
export function useRemoveBlueprint() {
  return useOwnershipMutation(removeBlueprintFromMine);
}

/**
 * Follows changes made in the other windows. Mounted once by the main window's
 * shell, so every screen showing possession is covered — including the ones
 * that do not know the palette exists.
 */
export function useBlueprintOwnershipSync(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let gone = false;

    void listen(BLUEPRINT_OWNED_EVENT, () => invalidate(queryClient))
      .then((stop) => {
        if (gone) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        console.error("cannot follow blueprint ownership", error);
      });

    return () => {
      gone = true;
      unlisten?.();
    };
  }, [queryClient]);
}
