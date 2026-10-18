import { emit, listen } from "@tauri-apps/api/event";
import { getNpsSystemChoice, setNpsSystemChoice } from "@/lib/settings";
import type { Fix } from "@/lib/nps";
import { withSystem } from "@/lib/nps";

/** Tells every open window that the system chosen by hand changed. */
const SYSTEM_CHOICE_EVENT = "nps://system-choice";

export { getNpsSystemChoice as readSystemChoice };

/**
 * Sets the system the player says they are in, or `null` to let the readings
 * tell. The overlay and the markers page each keep a copy, hence the event.
 */
export async function setSystemChoice(slug: string | null): Promise<void> {
  await setNpsSystemChoice(slug);
  await emit(SYSTEM_CHOICE_EVENT);
}

/** Subscribes to changes. Returns how to unsubscribe. */
export function onSystemChoiceChange(handler: () => void) {
  return listen(SYSTEM_CHOICE_EVENT, () => handler());
}

/**
 * The reading in the system chosen by hand if there is one, else in the one
 * its zones name: a choice wins over the zones, which still mistake Nyx for
 * Stanton at times.
 */
export function withChosenSystem(
  fix: Fix,
  systems: string[],
  chosen: string | null,
): Fix {
  return chosen ? { ...fix, system: chosen } : withSystem(fix, systems);
}
