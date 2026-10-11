import { translator } from "@/i18n/translate";
import { ApiError } from "@/lib/api-client";
import type { RefiningJob, RefiningLine } from "@/types/nexus";

/**
 * Refining orders, what the page, the dialogs and the watcher share. The same
 * rules as the site's `lib/refining.ts`: a change there is made here too.
 */

/** The query the page and the watcher read, refreshed every minute. */
export const REFINING_KEY = ["refining-jobs"] as const;

/** Beyond this, an entry is more surely a mistake than an order. */
export const MAX_REFINING_LINES = 40;
/** Thirty days: no order in the game runs longer. */
export const MAX_REFINING_DURATION = 30 * 24 * 60;

/**
 * What to tell of a refused save or collection: the site's codes, translated,
 * and `fallback` for the rest — never the server's raw text.
 */
export function refiningErrorMessage(
  error: unknown,
  fallback: "errorSave" | "errorCollect" | "errorDelete",
): string {
  const t = translator("Refining");
  const code =
    error instanceof ApiError &&
    typeof error.body === "object" &&
    error.body !== null &&
    "code" in error.body
      ? (error.body as { code?: unknown }).code
      : undefined;
  if (code === "not_found") return t("errorGone");
  if (code === "invalid_location") return t("errorLocation");
  return t(fallback);
}

/** The methods a refinery terminal offers. */
export const REFINING_METHODS = [
  "Cormack Method",
  "Dinyx Solventation",
  "Electrostarolysis",
  "Ferron Exchange",
  "Gaskin Process",
  "Kazen Winnowing",
  "Pyrometric Chromalysis",
  "Thermonatic Deposition",
  "XCR Reaction",
] as const;

/**
 * A duration in minutes, from «1d12h30m15s», «3h35m» or a number of minutes.
 * Seconds round up to the next minute; null when nothing reads.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (/^\d+$/.test(text)) {
    const minutes = parseInt(text, 10);
    return minutes > 0 ? minutes : null;
  }
  if (!/^(\d+\s*[dhms]\s*)+$/.test(text)) return null;

  const units: Record<string, number> = { d: 1440, h: 60, m: 1, s: 1 / 60 };
  let minutes = 0;
  for (const [, value, unit] of text.matchAll(/(\d+)\s*([dhms])/g)) {
    minutes += parseInt(value, 10) * units[unit];
  }
  const rounded = Math.ceil(minutes);
  return rounded > 0 ? rounded : null;
}

/** The typed duration that gives back `minutes`, as «1d3h35m». */
export function formatDurationInput(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  return (
    [days && `${days}d`, hours && `${hours}h`, rest && `${rest}m`]
      .filter(Boolean)
      .join("") || "0m"
  );
}

/** «1 j 3 h», «2 h 14 min», «35 min». */
export function formatMinutes(total: number): string {
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  // Beyond a day, minutes tell nothing more.
  const minutes = days > 0 ? 0 : total % 60;
  return translator("Refining")("durationShort", { days, hours, minutes })
    .replace(/\s+/g, " ")
    .trim();
}

/** Whole minutes left, rounded up; never negative. */
export function minutesLeft(job: Pick<RefiningJob, "endTime">, now: number) {
  return Math.max(0, Math.ceil((Date.parse(job.endTime) - now) / 60_000));
}

export function isFinished(job: Pick<RefiningJob, "endTime">, now: number) {
  return Date.parse(job.endTime) <= now;
}

/** The cSCU an order's lines give back. */
export function totalQuantity(lines: RefiningLine[]) {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

/** What a terminal gives back for nothing: left out of a collection by default. */
export function isInert(name: string) {
  return /inert/i.test(name);
}
