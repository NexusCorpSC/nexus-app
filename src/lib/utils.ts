import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formats a crafting time expressed in seconds as `2h 05m` / `45s`. */
export function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return "—";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(secs).padStart(2, "0")}s`;
  }
  return `${secs}s`;
}

/** Formats a UEC amount with thin-space thousands separators. */
export function formatUEC(amount?: number): string {
  if (amount === undefined || amount === null) return "—";
  return `${amount.toLocaleString("fr-FR")} aUEC`;
}

export function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Formats a plain number the French way: `1 150` / `37,5`. */
export function formatNumber(value?: number): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return "—";
  }
  return value.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

/** «1 h 20», from an ISO date; floored, since it says how long so far. */
export function formatElapsed(since: string, now: number): string {
  const start = Date.parse(since);
  if (Number.isNaN(start)) return "";
  const minutes = Math.max(0, Math.floor((now - start) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, "0")}` : `${hours} h`;
}

const RELATIVE_TIME = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });

/**
 * «il y a 23 jours», «hier», «à l'instant», from an ISO date or a timestamp
 * in milliseconds.
 */
export function formatAgo(value: string | number, now = Date.now()): string {
  const at = typeof value === "number" ? value : Date.parse(value);
  if (Number.isNaN(at)) return "";
  const seconds = Math.round((at - now) / 1000);
  if (Math.abs(seconds) < 60) return "à l'instant";

  // No weeks: «il y a 23 jours» says more than «il y a 3 semaines».
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 24 * 3600],
    ["month", 30 * 24 * 3600],
    ["day", 24 * 3600],
    ["hour", 3600],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return RELATIVE_TIME.format(Math.trunc(seconds / size), unit);
    }
  }
  return RELATIVE_TIME.format(Math.trunc(seconds / 60), "minute");
}
