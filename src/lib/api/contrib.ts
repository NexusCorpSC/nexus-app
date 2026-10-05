import { getLocale } from "@/i18n/locale";
import { translator } from "@/i18n/translate";
import { ApiError, apiRequest } from "@/lib/api-client";
import type {
  ConfirmationInput,
  ConfirmationResult,
  ContribSummary,
  PlaceMediaUploadResult,
} from "@/types/nexus";

/**
 * The reader's standing as a contributor (see `GET /api/me/contrib` in Nexus
 * Tools), with what happened since `since`: a contribution published or sent
 * back, an achievement, a level.
 */
export function getMyContrib(since?: string) {
  return apiRequest<ContribSummary>("/api/me/contrib", {
    params: { since, locale: getLocale() },
  });
}

export type PlaceMediaInput = {
  file: Blob;
  fileName: string;
  /** The image's size in pixels, as sent. */
  width: number;
  height: number;
  caption?: string;
  credit?: string;
};

/**
 * An image of a place, sent as a contribution (`POST /api/lieux/{slug}/media`):
 * published straight away from level 2, reviewed first below.
 */
export function uploadPlaceMedia(slug: string, input: PlaceMediaInput) {
  const form = new FormData();
  form.append("file", input.file, input.fileName);
  form.append("width", String(Math.round(input.width)));
  form.append("height", String(Math.round(input.height)));
  if (input.caption) form.append("caption", input.caption);
  if (input.credit) form.append("credit", input.credit);

  return apiRequest<PlaceMediaUploadResult>(
    `/api/lieux/${encodeURIComponent(slug)}/media`,
    { method: "POST", body: form },
  );
}

/** « Toujours exact », or not: a confirmation of an item's prices. */
export function confirmPrices(
  slug: string,
  accurate: boolean,
  comment?: string,
) {
  const input: ConfirmationInput = {
    target: { type: "item", slug },
    subject: "prices",
    accurate,
    comment,
  };
  return apiRequest<ConfirmationResult>("/api/confirmations", {
    method: "POST",
    body: input,
  });
}

/* The site answers a refusal with an error code; these are its words. */

const SHARED_CODES = ["unauthenticated", "suspended"] as const;

const MEDIA_CODES = [
  ...SHARED_CODES,
  "placeNotFound",
  "noMedia",
  "invalidMedia",
  "tooManyPending",
  "fileTooLarge",
  "uploadFailed",
  "tooManyUploads",
] as const;

const CONFIRMATION_CODES = [
  ...SHARED_CODES,
  "notFound",
  "invalidInput",
  "alreadyConfirmed",
] as const;

type ContribCode = (typeof MEDIA_CODES | typeof CONFIRMATION_CODES)[number];

/** The wording of each code, in the language on screen. */
function messagesOf(codes: readonly ContribCode[]): Record<string, string> {
  const t = translator("Api.contrib");
  return Object.fromEntries(codes.map((code) => [code, t(code)]));
}

function messageFor(
  codes: readonly ContribCode[],
  error: unknown,
  fallback: string,
): string {
  const messages = messagesOf(codes);
  if (error instanceof ApiError) {
    if (error.isUnauthorized) return messages.unauthenticated;
    const body = error.body as { error?: string } | undefined;
    if (body?.error && messages[body.error]) return messages[body.error];
    // A body too large for the server in front of the site: no JSON code.
    if (error.status === 413) return messages.fileTooLarge ?? error.message;
    return error.message;
  }
  return error instanceof Error ? error.message : fallback;
}

export function mediaErrorMessage(error: unknown): string {
  return messageFor(MEDIA_CODES, error, translator("Common")("sendFailed"));
}

export function confirmationErrorMessage(error: unknown): string {
  return messageFor(
    CONFIRMATION_CODES,
    error,
    translator("Common")("sendFailed"),
  );
}
