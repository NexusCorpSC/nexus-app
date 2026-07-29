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
 * Possession after the call, and whether this very call is what changed it.
 *
 * `owned` is the state the user ends up with rather than an echo of the verb:
 * a blueprint owned by everyone stays owned through a removal.
 *
 * Repeating either verb piles nothing up, which is what lets the **add** be
 * offered where possession is unknown — a second one simply answers «it was
 * already there». It is not a licence to offer a **removal** the same way:
 * repeating one is harmless, but a first one made in the dark takes away a
 * blueprint the user meant to keep.
 */
export type BlueprintOwnership = {
  owned: boolean;
  changed: boolean;
};

/** What the route answers, one flag per verb. */
type OwnershipResponse = {
  owned: boolean;
  added?: boolean;
  removed?: boolean;
};

function ownershipPath(blueprintId: string): string {
  return `/api/blueprints/${encodeURIComponent(blueprintId)}/ownership`;
}

/**
 * Adds a blueprint to «mes blueprints».
 *
 * Takes the blueprint id rather than its slug, which is what the list, the
 * detail and a search result all carry.
 */
export async function addBlueprintToMine(
  blueprintId: string,
): Promise<BlueprintOwnership> {
  const answer = await apiRequest<OwnershipResponse>(
    ownershipPath(blueprintId),
    { method: "POST" },
  );

  // Normalised here rather than left optional all the way to the buttons: one
  // flag per verb is the route's shape, not something a caller should reason
  // about — and an absent flag must not read as «it was already there».
  return { owned: answer.owned, changed: answer.added === true };
}

/** Drops a blueprint from «mes blueprints». */
export async function removeBlueprintFromMine(
  blueprintId: string,
): Promise<BlueprintOwnership> {
  const answer = await apiRequest<OwnershipResponse>(
    ownershipPath(blueprintId),
    { method: "DELETE" },
  );

  return { owned: answer.owned, changed: answer.removed === true };
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
