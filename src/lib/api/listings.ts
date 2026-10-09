import { apiRequest } from "@/lib/api-client";
import type { SellerShop } from "@/types/nexus";

/** The shops the reader sells in, their default one first. */
export function listMyShops() {
  return apiRequest<{ shops: SellerShop[] }>("/api/me/shops");
}

export type SellLotInput = {
  lotId: string;
  shopId: string;
  name: string;
  /** Per unit, in aUEC. */
  price: number;
  /** At most this many units of the lot; `null` sells the whole lot. */
  limit: number | null;
  /** `false` keeps the listing off sale, to finish in the back office. */
  publish: boolean;
};

/**
 * Puts a lot of the reader's inventory up for sale in one of their shops:
 * the listing then follows the lot (see `POST /api/me/listings` in Nexus
 * Tools). A refusal comes back as an `ApiError` whose body carries the code.
 */
export function sellLot(input: SellLotInput) {
  return apiRequest<{ listingId: string }>("/api/me/listings", {
    method: "POST",
    body: input,
  });
}
