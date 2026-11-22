import { apiRequest } from "@/lib/api-client";
import {
  getCachedRadarSignatures,
  setCachedRadarSignatures,
} from "@/lib/settings";
import {
  DEFAULT_RADAR_SIGNATURES,
  isRadarCategory,
  type RadarSignature,
} from "@/lib/radar";

/**
 * The known radar signatures, from the site, where administrators correct
 * them when a patch moves them.
 *
 * Read once and cached, so the scanner identifies what it reads with no
 * connection: in game, that is the normal case rather than the exception.
 */

export type SignatureSource = "network" | "cache" | "builtin";

export interface SignaturesResult {
  signatures: RadarSignature[];
  source: SignatureSource;
}

function isSignature(value: unknown): value is RadarSignature {
  if (!value || typeof value !== "object") return false;

  const signature = value as Record<string, unknown>;

  return (
    typeof signature.id === "string" &&
    signature.id !== "" &&
    typeof signature.name === "string" &&
    isRadarCategory(signature.category) &&
    typeof signature.value === "number" &&
    Number.isFinite(signature.value) &&
    signature.value > 0
  );
}

function readList(raw: unknown): RadarSignature[] {
  return Array.isArray(raw) ? raw.filter(isSignature) : [];
}

/** Asks the site, falls back on what was cached, then on the built-in list. */
export async function listRadarSignatures(): Promise<SignaturesResult> {
  const cached = readList(await getCachedRadarSignatures());

  try {
    const { signatures } = await apiRequest<{ signatures: unknown }>(
      "/api/radar-signatures",
      // The list is the same for everyone; no session is sent for it.
      { authenticated: false },
    );

    const usable = readList(signatures);

    if (usable.length > 0) {
      await setCachedRadarSignatures(usable);
      return { signatures: usable, source: "network" };
    }
  } catch {
    // Offline, or the site is down — which is exactly what the cache is for.
  }

  if (cached.length > 0) return { signatures: cached, source: "cache" };

  return { signatures: DEFAULT_RADAR_SIGNATURES, source: "builtin" };
}
