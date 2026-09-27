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

export function updateInventoryItem(
  itemId: string,
  input: Partial<InventoryItemInput>,
) {
  return apiRequest<InventoryItem>(
    `/api/inventory/items/${encodeURIComponent(itemId)}`,
    { method: "PATCH", body: input },
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
