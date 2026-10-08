import { translator } from "@/i18n/translate";
import { ApiError, apiRequest } from "@/lib/api-client";
import type {
  NpsResponse,
  PlacePosition,
  PlacePositionResult,
} from "@/types/nexus";

/**
 * What the NPS needs from the site: the bodies, with what it takes to find
 * one's way on them, and every place whose position has been recorded.
 */
export function getNpsData() {
  return apiRequest<NpsResponse>("/api/lieux/nps");
}

/**
 * The player's position, proposed as the position of a place: a correction of
 * the place like any other, published straight away from level 3 and
 * reviewed first below.
 */
export function submitPlacePosition(slug: string, position: PlacePosition) {
  return apiRequest<PlacePositionResult>(
    `/api/lieux/${encodeURIComponent(slug)}/position`,
    { method: "POST", body: { position } },
  );
}

/** The site's refusal codes for a position, in the language on screen. */
const POSITION_CODES = [
  "unauthenticated",
  "suspended",
  "placeNotFound",
  "tooManyPending",
  "noChange",
  "invalidInput",
] as const;

export function positionErrorMessage(error: unknown): string {
  const t = translator("NpsOverlay.errors");
  if (error instanceof ApiError) {
    if (error.isUnauthorized) return t("unauthenticated");
    const code = (error.body as { error?: string } | undefined)?.error;
    const known = POSITION_CODES.find((one) => one === code);
    if (known) return t(known);
    return error.message;
  }
  return error instanceof Error
    ? error.message
    : translator("Common")("sendFailed");
}
