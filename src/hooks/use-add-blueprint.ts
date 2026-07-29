import { useEffect } from "react";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addBlueprintToMine } from "@/lib/api/blueprints";

/**
 * Announces an add to every window.
 *
 * Each window is its own React tree with its own query cache, and the client
 * does not refetch on focus, so a blueprint added from the search palette would
 * otherwise still read «Non possédé» in the main window for as long as it stays
 * open. Same idea as `CARGO_EVENT`.
 */
export const BLUEPRINT_OWNED_EVENT = "blueprints://owned";

/** Drops every cached view of blueprint possession in this window. */
function invalidate(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: ["blueprints"] });
  void queryClient.invalidateQueries({ queryKey: ["blueprint"] });
}

/**
 * Adds a blueprint to «mes blueprints», from wherever one is shown.
 *
 * The mutation carries the whole outcome: `added` tells an already-owned
 * blueprint from a freshly added one, which the search palette needs since a
 * result says nothing about possession.
 */
export function useAddBlueprint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (blueprintId: string) => addBlueprintToMine(blueprintId),
    onSuccess: () => {
      invalidate(queryClient);
      void emit(BLUEPRINT_OWNED_EVENT);
    },
  });
}

/**
 * Follows adds made in the other windows. Mounted once by the main window's
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
