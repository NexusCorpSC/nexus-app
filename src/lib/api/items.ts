import { apiRequest } from "@/lib/api-client";
import type {
  ItemDetails,
  ItemFacets,
  ItemKind,
  ItemPage,
} from "@/types/nexus";

export type ItemFilters = {
  query?: string;
  kind?: ItemKind;
  category?: string;
  subcategory?: string;
  manufacturer?: string;
  page?: number;
  limit?: number;
};

/** Every in-game object: items, weapons, vehicles and resources. */
export function listItems(filters: ItemFilters = {}) {
  return apiRequest<ItemPage>("/api/items", {
    params: {
      query: filters.query,
      kind: filters.kind,
      category: filters.category,
      subcategory: filters.subcategory,
      manufacturer: filters.manufacturer,
      page: filters.page,
      limit: filters.limit,
    },
  });
}

/**
 * One object with everything its fiche shows: blueprints, variants, set,
 * resolved slots, class comparison and the objects carrying it.
 */
export function getItem(slug: string) {
  return apiRequest<ItemDetails>(`/api/items/${encodeURIComponent(slug)}`);
}

/** Values the filters offer: categories with their subcategories, makers. */
export function listItemFacets() {
  return apiRequest<ItemFacets>("/api/items/facets");
}
