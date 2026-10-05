import { ApiError, apiRequest } from "@/lib/api-client";
import { translator } from "@/i18n/translate";
import type { Parcel } from "@/types/nexus";

/**
 * Parcels: lots handed from one player's inventory to another's by an
 * 8-character code (see `lib/parcels.ts` in Nexus Tools). Sealing reserves
 * the quantities; accepting moves them, in one go.
 */

export function listParcels() {
  return apiRequest<Parcel[]>("/api/inventory/parcels");
}

/** Seals the package: one entry per lot, in the lot's own unit. */
export function createParcel(items: { itemId: string; quantity: number }[]) {
  return apiRequest<Parcel>("/api/inventory/parcels", {
    method: "POST",
    body: { items },
  });
}

/** What a code holds and who sent it, before accepting. */
export function previewParcel(code: string) {
  return apiRequest<Parcel>(
    `/api/inventory/parcels/${encodeURIComponent(code)}`,
  );
}

export function acceptParcel(
  code: string,
  input: { locationId: string; orgVisible: boolean },
) {
  return apiRequest<{ parcel: Parcel; created: number; merged: number }>(
    `/api/inventory/parcels/${encodeURIComponent(code)}/accept`,
    { method: "POST", body: input },
  );
}

/** Takes back a parcel still waiting: nothing moved, the code stops working. */
export function cancelParcel(code: string) {
  return apiRequest<Parcel>(
    `/api/inventory/parcels/${encodeURIComponent(code)}`,
    { method: "DELETE" },
  );
}

/** The refusals of the parcels API that have a sentence of their own. */
const KNOWN_ERRORS = [
  "invalid_code",
  "invalid_items",
  "invalid_location",
  "not_found",
  "too_many_attempts",
  "own_parcel",
  "delivered",
  "cancelled",
  "expired",
] as const;

type KnownError = (typeof KNOWN_ERRORS)[number];

function isKnownError(code: string): code is KnownError {
  return (KNOWN_ERRORS as readonly string[]).includes(code);
}

/** A refusal of the parcels API, as a sentence. */
export function parcelErrorMessage(error: unknown): string {
  const t = translator("Parcels.errors");
  if (error instanceof ApiError) {
    const body = error.body as { error?: string; item?: string } | undefined;
    const code = body?.error;
    if (code === "unavailable") {
      return t("unavailable", { item: body?.item || t("someLot") });
    }
    if (code && isKnownError(code)) return t(code);
    return error.message;
  }
  return error instanceof Error ? error.message : t("generic");
}

/** A code as typed: capitals and digits, at most 8. */
export function cleanParcelCode(raw: string) {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

/** "K7QM2X9A" → "K7QM-2X9A". */
export function formatParcelCode(code: string) {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
