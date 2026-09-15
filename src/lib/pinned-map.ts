import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getPinnedMap, setPinnedMap } from "@/lib/settings";

/** Dit à toute fenêtre ouverte que la carte épinglée a changé. */
const PINNED_MAP_EVENT = "map://pinned";

export { getPinnedMap as readPinnedMap };

/**
 * Désigne le lieu dont l'overlay Carte montre le plan.
 *
 * Comme la feuille de fret : chaque fenêtre garde sa copie, et l'overlay est
 * créé au démarrage. Sans cet événement il montrerait ce qui était épinglé à ce
 * moment-là, et cela pour toute la durée de la session.
 */
export async function pinMap(slug: string | null): Promise<void> {
  await setPinnedMap(slug);
  await emit(PINNED_MAP_EVENT);
}

/**
 * Fait monter l'overlay Carte à l'écran.
 *
 * Il monte, il ne bascule pas : le bouton qui appelle ceci promet d'afficher
 * la carte, et une bascule la retirerait à qui avait déjà la fenêtre ouverte.
 * La refermer est l'affaire du raccourci.
 */
export function showMapOverlay(): Promise<void> {
  return invoke("open_map_overlay");
}

/** S'abonne aux changements. Rend de quoi se désabonner. */
export function onPinnedMapChange(handler: () => void) {
  return listen(PINNED_MAP_EVENT, () => handler());
}
