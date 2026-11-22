import { emit, listen } from "@tauri-apps/api/event";
import { DEFAULT_HALO_BAND } from "@/lib/aaron-halo";
import { setDestination } from "@/lib/nps-destination";
import {
  getHaloRoute,
  setHaloRoute,
  type NpsDestination,
} from "@/lib/settings";
import { showOverlay } from "@/lib/windows";

/** Tells the quantum navigation overlay to show the NPS destination. */
const POINT_EVENT = "halo://point";

/**
 * « Y aller » : fait de `destination` celle du NPS et ouvre la superposition
 * de navigation quantique sur son onglet « Point », qui dit quel saut lancer
 * et où le couper pour s'en approcher (`src/lib/quantum-route.ts`).
 */
export async function goWithQuantumJump(
  destination: NpsDestination,
): Promise<void> {
  await setDestination(destination);
  const stored = await getHaloRoute();
  await setHaloRoute({
    from: stored.from ?? "arc-l1",
    to: stored.to ?? null,
    band: stored.band ?? DEFAULT_HALO_BAND,
    mode: "point",
    pointFrom: stored.pointFrom ?? null,
  });
  // Déjà ouverte, elle garde son état en mémoire : on la prévient.
  await emit(POINT_EVENT);
  await showOverlay("halo");
}

/** Subscribes to « Y aller ». Returns how to unsubscribe. */
export function onQuantumPoint(handler: () => void) {
  return listen(POINT_EVENT, () => handler());
}
