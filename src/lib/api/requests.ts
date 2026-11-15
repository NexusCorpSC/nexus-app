import { apiRequest } from "@/lib/api-client";
import type {
  AppRequestsSummary,
  OfferAction,
  PlayerRequest,
  RequestAudience,
  RequestDetail,
  RequestKindFilter,
  RequestOffer,
} from "@/types/requests";

/** The request board (see `GET /api/requests` in Nexus Tools). */
export type BoardFilters = {
  q?: string;
  aud?: "friends" | "orgs" | "public";
  kind?: RequestKindFilter;
  system?: string;
  supply?: boolean;
  offset?: number;
  limit?: number;
};

export type RequestBoard = {
  requests: PlayerRequest[];
  total: number;
  /** The reader's organizations: the audiences a request can aim at. */
  orgs: { id: string; name: string }[];
};

export function listRequestBoard(filters: BoardFilters = {}) {
  return apiRequest<RequestBoard>("/api/requests", {
    params: {
      q: filters.q,
      aud: filters.aud,
      kind: filters.kind,
      system: filters.system,
      supply: filters.supply ? "1" : undefined,
      offset: filters.offset,
      limit: filters.limit,
    },
  });
}

export type RequestInput = {
  name?: string;
  itemSlug?: string;
  quantity: number;
  unit?: string | null;
  minQuality?: number | null;
  locationId?: string | null;
  unitPrice?: number | null;
  note?: string | null;
  audience: RequestAudience;
  expiresInDays: number;
};

export function createRequest(input: RequestInput) {
  return apiRequest<PlayerRequest>("/api/requests", {
    method: "POST",
    body: input,
  });
}

export function getRequestDetail(id: string) {
  return apiRequest<RequestDetail>(`/api/requests/${encodeURIComponent(id)}`);
}

export type RequestChange =
  | {
      action: "update";
      quantity?: number;
      minQuality?: number | null;
      locationId?: string | null;
      unitPrice?: number | null;
      note?: string | null;
      audience?: RequestAudience;
    }
  | { action: "extend"; days: number }
  | { action: "close" };

export function changeRequest(id: string, change: RequestChange) {
  return apiRequest<PlayerRequest>(`/api/requests/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: change,
  });
}

export type OfferInput = {
  quantity?: number;
  quality?: number | null;
  unitPrice?: number | null;
  inventoryItemId?: string | null;
  message?: string | null;
};

/** «J'en ai»: an offer on someone else's request, with its private thread. */
export function createOffer(requestId: string, input: OfferInput) {
  return apiRequest<RequestOffer>(
    `/api/requests/${encodeURIComponent(requestId)}/offers`,
    { method: "POST", body: input },
  );
}

export function postOfferMessage(offerId: string, body: string) {
  return apiRequest<{ offer: RequestOffer }>(
    `/api/requests/offers/${encodeURIComponent(offerId)}`,
    { method: "POST", body: { action: "message", body } },
  );
}

export type OfferActionInput = {
  unitPrice?: number;
  quantity?: number;
  message?: string | null;
  addToInventory?: { locationId: string } | null;
};

export function actOnOffer(
  offerId: string,
  action: OfferAction,
  input: OfferActionInput = {},
) {
  return apiRequest<{
    offer: RequestOffer;
    request: PlayerRequest;
    /** Pour `receive` avec rangement : si l'ajout à l'inventaire a réussi. */
    inventory?: { added: boolean; error?: string };
  }>(`/api/requests/offers/${encodeURIComponent(offerId)}`, {
    method: "POST",
    body: { ...input, action },
  });
}

/**
 * The reader's requests and offers, and what happened to them since `since`
 * (see `GET /api/me/requests` in Nexus Tools).
 */
export function getMyRequests(since?: string) {
  return apiRequest<AppRequestsSummary>("/api/me/requests", {
    params: { since },
  });
}

/** Everything on the board's bell read: the site's bell goes quiet as well. */
export function markRequestNoticesSeen() {
  return apiRequest<void>("/api/me/request-notices", {
    method: "POST",
    body: {},
  });
}

/** Whether new requests of friends and organizations are announced at all. */
export function getRequestAlerts() {
  return apiRequest<{ unseen: number; alertsOff: boolean }>(
    "/api/me/request-notices",
  );
}

export function setRequestAlertsOff(alertsOff: boolean) {
  return apiRequest<{ alertsOff: boolean }>("/api/me/request-notices", {
    method: "POST",
    body: { alertsOff },
  });
}
