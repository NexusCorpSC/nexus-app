import { apiRequest } from "@/lib/api-client";
import type {
  Blueprint,
  BlueprintCategory,
  BlueprintPage,
} from "@/types/nexus";

export type BlueprintFilters = {
  query?: string;
  category?: string;
  subcategory?: string;
  /** undefined = all, true = owned only, false = not owned (requires a session). */
  owned?: boolean;
  materials?: string[];
  page?: number;
  limit?: number;
};

export function listBlueprints(filters: BlueprintFilters = {}) {
  return apiRequest<BlueprintPage>("/api/blueprints", {
    params: {
      query: filters.query,
      category: filters.category,
      subcategory: filters.subcategory,
      owned: filters.owned === undefined ? undefined : String(filters.owned),
      materials: filters.materials?.length
        ? filters.materials.join(",")
        : undefined,
      page: filters.page,
      limit: filters.limit,
    },
  });
}

/** Fuzzy quick-search used by the command palette. */
export function searchBlueprints(query: string) {
  return apiRequest<Blueprint[]>("/api/blueprints", {
    params: { query, fuzzy: "true" },
  });
}

export function getBlueprint(slug: string) {
  return apiRequest<Blueprint>(`/api/blueprints/${encodeURIComponent(slug)}`);
}

export function listBlueprintCategories() {
  return apiRequest<BlueprintCategory[]>("/api/blueprints/categories");
}

export function listComponentNames(query?: string) {
  return apiRequest<string[]>("/api/blueprints/component-names", {
    params: { query },
  });
}
