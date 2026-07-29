import { apiRequest } from "@/lib/api-client";
import type { FactionWithBlueprints } from "@/types/nexus";

/**
 * Every faction, with the blueprints its missions reward.
 *
 * Answers the question the mission list cannot: *which faction do I fly for to
 * get this blueprint*. The route takes no filter and returns everything, so it
 * is fetched once and searched here.
 */
export function listFactionBlueprints() {
  return apiRequest<FactionWithBlueprints[]>("/api/factions");
}
