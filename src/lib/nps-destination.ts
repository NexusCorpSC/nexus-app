import { emit, listen } from "@tauri-apps/api/event";
import { getNpsDestination, setNpsDestination } from "@/lib/settings";

/** Tells every open window that the NPS destination changed. */
const DESTINATION_EVENT = "nps://destination";

export { getNpsDestination as readNpsDestination };

/**
 * Sets the place the NPS overlay guides to — from the overlay itself, or from
 * a place's page in the main window. The overlay is created at startup and
 * keeps its own copy, hence the event, as for the pinned map.
 */
export async function setDestination(slug: string | null): Promise<void> {
  await setNpsDestination(slug);
  await emit(DESTINATION_EVENT);
}

/** Subscribes to changes. Returns how to unsubscribe. */
export function onDestinationChange(handler: () => void) {
  return listen(DESTINATION_EVENT, () => handler());
}
