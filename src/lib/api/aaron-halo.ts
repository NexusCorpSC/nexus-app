import { apiRequest } from "@/lib/api-client";
import { getCachedHaloData, setCachedHaloData } from "@/lib/settings";
import {
  DEFAULT_HALO_BANDS,
  HALO_POINTS,
  isHaloBand,
  isHaloPoint,
  type HaloBand,
  type HaloPoint,
} from "@/lib/aaron-halo";

/**
 * The Aaron Halo's bands and Stanton's jump targets, from the site, where a
 * survey corrected after a patch reaches the app without a new version.
 *
 * Read once and cached, so the navigator works with no connection.
 */

export type HaloSource = "network" | "cache" | "builtin";

export interface HaloData {
  bands: HaloBand[];
  points: HaloPoint[];
  source: HaloSource;
}

function read(raw: unknown): { bands: HaloBand[]; points: HaloPoint[] } {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    bands: Array.isArray(data.bands) ? data.bands.filter(isHaloBand) : [],
    points: Array.isArray(data.points) ? data.points.filter(isHaloPoint) : [],
  };
}

function usable(data: { bands: HaloBand[]; points: HaloPoint[] }) {
  return data.bands.length > 0 && data.points.length > 1;
}

/** Asks the site, falls back on what was cached, then on the built-in data. */
export async function getHaloData(): Promise<HaloData> {
  try {
    const fetched = read(
      await apiRequest<unknown>("/api/aaron-halo", {
        // The same for everyone; no session is sent for it.
        authenticated: false,
      }),
    );
    if (usable(fetched)) {
      await setCachedHaloData(fetched);
      return { ...fetched, source: "network" };
    }
  } catch {
    // Offline, or the site is down — which is exactly what the cache is for.
  }

  const cached = read(await getCachedHaloData());
  if (usable(cached)) return { ...cached, source: "cache" };

  return { bands: DEFAULT_HALO_BANDS, points: HALO_POINTS, source: "builtin" };
}
