import { apiRequest } from "@/lib/api-client";
import type { InventoryItem, InventoryItemInput, Location } from "@/types/nexus";

export type InventoryFilters = {
  query?: string;
  locationId?: string;
  /** Minimum quality. */
  quality?: number;
};

export function listInventoryItems(filters: InventoryFilters = {}) {
  return apiRequest<InventoryItem[]>("/api/inventory/items", {
    params: {
      query: filters.query,
      locationId: filters.locationId,
      quality: filters.quality,
    },
  });
}

export function createInventoryItem(input: InventoryItemInput) {
  return apiRequest<InventoryItem>("/api/inventory/items", {
    method: "POST",
    body: input,
  });
}

export type BulkInventoryRow = {
  name: string;
  /** Kept on a new lot only: a lot topped up keeps its own. */
  description?: string;
  quality?: number;
  quantity: number;
  unit?: string;
  locationId: string;
  orgVisible: boolean;
};

/**
 * Adds several items at once. A row matching a lot already held — same name,
 * quality and unit at the same place — tops it up instead of adding a second.
 */
export function bulkAddInventoryItems(rows: BulkInventoryRow[]) {
  return apiRequest<{ created: number; merged: number }>(
    "/api/inventory/items/bulk",
    { method: "POST", body: { rows } },
  );
}

/** Shares the item with the member's organizations, or stops sharing it. */
export function setInventoryItemOrgVisible(itemId: string, orgVisible: boolean) {
  return apiRequest<{ ok: boolean }>(
    `/api/inventory/items/${encodeURIComponent(itemId)}`,
    { method: "PATCH", body: { op: "setOrgVisible", orgVisible } },
  );
}

/** Adds to the lot, or takes from it when `delta` is negative. */
export function adjustInventoryItem(itemId: string, delta: number) {
  return apiRequest<{ quantity: number }>(
    `/api/inventory/items/${encodeURIComponent(itemId)}`,
    { method: "PATCH", body: { op: "adjust", delta } },
  );
}

export function deleteInventoryItem(itemId: string) {
  return apiRequest<{ success?: boolean }>(
    `/api/inventory/items/${encodeURIComponent(itemId)}`,
    { method: "DELETE" },
  );
}

export function listLocations(query?: string) {
  return apiRequest<Location[]>("/api/inventory/locations", {
    params: { query },
  });
}

export function createLocation(input: { name: string; system?: string }) {
  return apiRequest<Location>("/api/inventory/locations", {
    method: "POST",
    body: input,
  });
}
