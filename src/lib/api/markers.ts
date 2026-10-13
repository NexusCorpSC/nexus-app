import { translator } from "@/i18n/translate";
import { ApiError, apiRequest } from "@/lib/api-client";
import type {
  MarkerCollectionInput,
  MarkerInput,
  MarkerKind,
  MarkerListResponse,
} from "@/types/markers";

/**
 * Les marqueurs du joueur et ceux des collections partagées avec ses
 * organisations. Le NPS les reçoit aussi avec `GET /api/lieux/nps` ; cette
 * route-ci donne en plus les collections, pour la page et le formulaire.
 */
const MARKERS = "/api/marqueurs";

export function listMarkers(
  filters: {
    /** Une collection, ou `none` : « Sans collection ». */
    collection?: string;
    kind?: MarkerKind;
    query?: string;
  } = {},
) {
  return apiRequest<MarkerListResponse>(MARKERS, {
    params: {
      collection: filters.collection,
      kind: filters.kind,
      query: filters.query,
    },
  });
}

export function createMarker(input: MarkerInput) {
  return apiRequest<{ id: string }>(MARKERS, { method: "POST", body: input });
}

export function updateMarker(id: string, input: MarkerInput) {
  return apiRequest<{ id: string }>(`${MARKERS}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
  });
}

export function deleteMarker(id: string) {
  return apiRequest<void>(`${MARKERS}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** Les renommer, les colorer ou les partager se fait sur le site. */
export function createMarkerCollection(input: MarkerCollectionInput) {
  return apiRequest<{ id: string }>(`${MARKERS}/collections`, {
    method: "POST",
    body: input,
  });
}

/** Les codes de refus du site pour un marqueur, dans la langue affichée. */
const MARKER_CODES = [
  "invalidInput",
  "notFound",
  "forbidden",
  "tooMany",
] as const;

export function markerErrorMessage(error: unknown): string {
  const t = translator("Markers.errors");
  if (error instanceof ApiError) {
    if (error.isUnauthorized) return t("unauthorized");
    const code = (error.body as { error?: string } | undefined)?.error;
    const known = MARKER_CODES.find((one) => one === code);
    if (known) return t(known);
    return error.message;
  }
  return error instanceof Error
    ? error.message
    : translator("Common")("sendFailed");
}

/** Le site ne connaît plus la collection demandée : supprimée entre-temps. */
export function isNotFound(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 404 ||
      (error.body as { error?: string } | undefined)?.error === "notFound")
  );
}
