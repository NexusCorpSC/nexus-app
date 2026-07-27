import { apiRequest } from "@/lib/api-client";
import type { PlayerReputations, RepFaction } from "@/types/nexus";

/** Faction configuration: standings, careers and levels. Public. */
export function listRepFactions() {
  return apiRequest<{ factions: RepFaction[] }>("/api/reps/factions").then(
    (r) => r.factions,
  );
}

/** The signed-in player's reputations. */
export function getPlayerReputations() {
  return apiRequest<{ reputations: PlayerReputations }>("/api/reps").then(
    (r) => r.reputations,
  );
}

export type ReputationUpdate = {
  factionName: string;
  standing?: string;
  careerName?: string;
  levelName?: string;
};

export function updatePlayerReputation(update: ReputationUpdate) {
  return apiRequest<{ reputations: PlayerReputations }>("/api/reps", {
    method: "PUT",
    body: update,
  }).then((r) => r.reputations);
}
