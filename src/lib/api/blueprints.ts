import { apiRequest } from "@/lib/api-client";
import type {
  Blueprint,
  BlueprintCategory,
  BlueprintOrgMember,
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

export function getBlueprint(slug: string) {
  return apiRequest<Blueprint>(`/api/blueprints/${encodeURIComponent(slug)}`);
}

/**
 * Which members of `orgId` own this blueprint.
 *
 * The caller has to be a member of that organization — the route answers 403
 * otherwise — so this is only ever asked for the user's own organizations.
 */
export function listBlueprintOrgOwners(blueprintId: string, orgId: string) {
  return apiRequest<BlueprintOrgMember[]>(
    `/api/blueprints/${encodeURIComponent(blueprintId)}/org-owners`,
    { params: { orgId } },
  );
}

export function listBlueprintCategories() {
  return apiRequest<BlueprintCategory[]>("/api/blueprints/categories");
}

export function listComponentNames(query?: string) {
  return apiRequest<string[]>("/api/blueprints/component-names", {
    params: { query },
  });
}
