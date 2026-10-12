import { apiRequest } from "@/lib/api-client";
import type {
  LoreArticle,
  LorePage,
  StarSystem,
  StarSystemSummary,
} from "@/types/lore";

/**
 * Le lore du 'Verse : la Galactapedia et la starmap de RSI, importées par le
 * site depuis l'API du Star Citizen Wiki. Les textes sont en anglais.
 */

export type LoreFilters = { query?: string; category?: string; page?: number };

export function browseLore(filters: LoreFilters = {}) {
  return apiRequest<LorePage>("/api/lore", {
    params: {
      q: filters.query,
      category: filters.category,
      page: filters.page,
    },
  });
}

export function getLoreArticle(id: string) {
  return apiRequest<LoreArticle>(`/api/lore/${encodeURIComponent(id)}`);
}

export function listStarSystems() {
  return apiRequest<StarSystemSummary[]>("/api/lore/systems");
}

export function getStarSystem(code: string) {
  return apiRequest<StarSystem>(
    `/api/lore/systems/${encodeURIComponent(code)}`,
  );
}
