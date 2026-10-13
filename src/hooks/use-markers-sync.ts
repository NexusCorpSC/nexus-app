import { useEffect } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

/**
 * Un marqueur créé, modifié ou supprimé, annoncé à toutes les fenêtres.
 *
 * Chacune a son propre cache et ne relit rien en reprenant le focus : sans
 * cela, un marqueur posé au raccourci depuis la superposition du NPS
 * manquerait à la page Marqueurs, et un marqueur supprimé de la page
 * resterait proposé comme destination. Même idée que `BLUEPRINT_OWNED_EVENT`.
 */
const MARKERS_CHANGED_EVENT = "markers://changed";

/** Les marqueurs se lisent avec la liste et avec les données du NPS. */
function invalidate(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["markers"] });
  void queryClient.invalidateQueries({ queryKey: ["nps"] });
}

/** À appeler après chaque changement : cette fenêtre-ci, puis les autres. */
export function markersChanged(queryClient: QueryClient): void {
  invalidate(queryClient);
  void emit(MARKERS_CHANGED_EVENT).catch((error) =>
    console.error("cannot announce the markers change", error),
  );
}

/** Relit les marqueurs quand une autre fenêtre en a changé. */
export function useMarkersSync(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const pending = listen(MARKERS_CHANGED_EVENT, () =>
      invalidate(queryClient),
    );
    return () => {
      void pending.then((stop) => stop()).catch(() => {});
    };
  }, [queryClient]);
}
