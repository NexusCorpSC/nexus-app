import { apiRequest } from "@/lib/api-client";
import type { ContribSummary } from "@/types/nexus";

/**
 * The reader's standing as a contributor (see `GET /api/me/contrib` in Nexus
 * Tools), with what happened since `since`: a contribution published or sent
 * back, an achievement, a level.
 */
export function getMyContrib(since?: string) {
  return apiRequest<ContribSummary>("/api/me/contrib", {
    params: { since, locale: "fr" },
  });
}
