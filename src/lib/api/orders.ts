import { apiRequest } from "@/lib/api-client";
import type { AppOrdersSummary } from "@/types/nexus";

/**
 * The reader's marketplace orders (see `GET /api/me/orders` in Nexus Tools):
 * those they placed, those their shops received, and what happened to them
 * since `since`.
 */
export function getMyOrders(since?: string) {
  return apiRequest<AppOrdersSummary>("/api/me/orders", {
    params: { since },
  });
}
