import { ApiError, apiRequest } from "@/lib/api-client";
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

const MESSAGES: Record<string, string | ((item: string) => string)> = {
  invalid_code: "Ce n'est pas un code de colis : 8 lettres ou chiffres.",
  invalid_items:
    "Le colis contient un lot qui n'est plus dans votre inventaire.",
  invalid_location: "Choisissez un lieu de stockage.",
  not_found: "Aucun colis n'a ce code.",
  too_many_attempts: "Trop de codes erronés : réessayez dans quelques minutes.",
  own_parcel: "C'est votre propre colis : donnez ce code à un autre joueur.",
  delivered: "Ce colis a déjà été reçu.",
  cancelled: "L'expéditeur a annulé ce colis.",
  expired: "Ce code a expiré.",
  unavailable: (item) =>
    `${item || "Un lot"} : la quantité n'est plus disponible.`,
};

/** A refusal of the parcels API, as a sentence. */
export function parcelErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { error?: string; item?: string } | undefined;
    const message = body?.error ? MESSAGES[body.error] : undefined;
    if (typeof message === "function") return message(body?.item ?? "");
    if (message) return message;
    return error.message;
  }
  return error instanceof Error ? error.message : "L'opération a échoué.";
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
