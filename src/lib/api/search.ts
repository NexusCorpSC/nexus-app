import { apiRequest } from "@/lib/api-client";
import type { SearchResponse } from "@/types/nexus";

/**
 * The generalized search: blueprints, missions, factions, items on sale, shops,
 * organizations, cargo ships, and — with a session — the caller's own
 * inventory. One ranked list, each result carrying its type and the page that
 * shows it.
 *
 * `limit` is per type, not overall.
 */
export function searchEverything(query: string, limit?: number) {
  return apiRequest<SearchResponse>("/api/search", {
    params: { query, limit },
  });
}
