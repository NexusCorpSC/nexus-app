import { ApiError } from "@/lib/api-client";
import { REQUEST_ERRORS, type RequestErrorCode } from "@/types/requests";

/** The query the Requests page reads, refreshed when the watcher sees news. */
export const REQUESTS_KEY = ["requests"] as const;

/** The board, one query per set of filters. */
export const REQUEST_BOARD_KEY = ["request-board"] as const;

/** One request's detail. */
export const requestDetailKey = (id: string) => ["request", id] as const;

/** The app's screen for a request, and for an offer on it. */
export function requestRoute(id: string, offerId?: string): string {
  return `/requests/${id}${offerId ? `?offer=${offerId}` : ""}`;
}

/** The site's path for a request (`/demandes/…`), turned into the app's. */
export function routeOfSitePath(path: string): string {
  const match = /^\/demandes\/([^/#?]+)(?:#offre-([^/?]+))?/.exec(path);
  return match ? requestRoute(match[1], match[2]) : "/requests";
}

/** The known refusals of the API, by their code; null for anything else. */
export function requestErrorCode(error: unknown): RequestErrorCode | null {
  if (!(error instanceof ApiError)) return null;
  const code = (error.body as { error?: unknown } | undefined)?.error;
  return (REQUEST_ERRORS as readonly unknown[]).includes(code)
    ? (code as RequestErrorCode)
    : null;
}
