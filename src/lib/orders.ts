import { openOnSite } from "@/lib/org-events";
import type { OrderStatus } from "@/types/nexus";

/** The query the Orders page reads, refreshed when the watcher sees news. */
export const ORDERS_KEY = ["orders"] as const;

/**
 * The «Open» button of an order toast: the overlay that draws it cannot open
 * a browser tab for the site, the main window can.
 */
export const ORDER_OPEN_EVENT = "orders://open";

export type OrderOpen = { path: string };

export function isOrderOpen(payload: unknown): payload is OrderOpen {
  const candidate = payload as Partial<OrderOpen> | null;
  // A path of the site, never a whole address handed over by a payload.
  return typeof candidate?.path === "string" && candidate.path.startsWith("/");
}

/** Opens an order on the site, on the buyer's page or the shop's. */
export function openOrder(path: string): Promise<void> {
  return openOnSite(path);
}

export type StatusTone = "warn" | "info" | "ok" | "bad" | "dim";

/** The colour of each step, as on the site. */
export const STATUS_TONES: Record<OrderStatus, StatusTone> = {
  PENDING: "warn",
  QUOTED: "info",
  CONFIRMED: "ok",
  ACCEPTED: "ok",
  READY: "info",
  DELIVERED: "dim",
  REFUSED: "bad",
  CANCELLED: "dim",
};

/** Orders still waiting on someone. */
export const OPEN_STATUSES: OrderStatus[] = [
  "PENDING",
  "QUOTED",
  "CONFIRMED",
  "ACCEPTED",
  "READY",
];
