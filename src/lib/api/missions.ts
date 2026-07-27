import { apiRequest } from "@/lib/api-client";
import type { Mission, MissionFaction, MissionPage } from "@/types/nexus";

export type MissionFilters = {
  query?: string;
  factionId?: string;
  hasBlueprints?: boolean;
  page?: number;
  limit?: number;
};

export function listMissions(filters: MissionFilters = {}) {
  return apiRequest<MissionPage>("/api/missions", {
    params: {
      query: filters.query,
      factionId: filters.factionId,
      hasBlueprints: filters.hasBlueprints ? "true" : undefined,
      page: filters.page,
      limit: filters.limit,
    },
  });
}

export function getMission(missionId: string) {
  return apiRequest<Mission>(`/api/missions/${encodeURIComponent(missionId)}`);
}

/** Factions that have at least one mission, used for the mission filter. */
export function listMissionFactions() {
  return apiRequest<MissionFaction[]>("/api/missions/factions");
}
