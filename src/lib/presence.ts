import { getLocale } from "@/i18n/locale";
import { translator } from "@/i18n/translate";
import {
  PLANNED_SESSION_GRACE_HOURS,
  type MyPresence,
  type PlannedSession,
} from "@/types/nexus";

/**
 * Reading a planned session, in the reader's time zone — the server keeps
 * instants, the time zone is the reader's own.
 */

function timeFormat() {
  return new Intl.DateTimeFormat(getLocale(), { hour: "2-digit", minute: "2-digit" });
}

/** Local days from `from` to `to`, midnight to midnight. */
export function daysBetween(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/** «21:00», from an ISO date. */
export function formatTime(iso: string): string {
  return timeFormat().format(new Date(iso));
}

/**
 * When a planned session is: «21:00» the same day, «demain 21:00», then
 * «sam. 21:00» — it is never more than two weeks away.
 */
export function formatPlannedTime(at: string, now = Date.now()): string {
  const date = new Date(at);
  const days = daysBetween(new Date(now), date);
  const time = timeFormat().format(date);
  const t = translator("Format");

  if (days <= 0) return time;
  if (days === 1) return t("tomorrowAt", { time });
  const weekday = new Intl.DateTimeFormat(getLocale(), { weekday: "short" }).format(date);
  return t("weekdayAt", { weekday, time });
}

/** «Session prévue · 21:00 · Minage», as the menu and the friends list say it. */
export function plannedLabel(planned: PlannedSession, now = Date.now()) {
  const parts = [translator("Format")("plannedSession"), formatPlannedTime(planned.at, now)];
  if (planned.activity) parts.push(planned.activity);
  return parts.join(" · ");
}

/**
 * The planned session to show beside the declaration: an older site answers
 * without the field, which reads as none.
 */
export function plannedOf(
  presence: Pick<MyPresence, "planned"> | null | undefined,
): PlannedSession | null {
  return presence?.planned ?? null;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** «21:00» for an `<input type="time">`, from an ISO date. */
export function toTimeField(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The next occurrence of «HH:MM», as an ISO date: today, or tomorrow once
 * today's is more than the grace period behind — at 23:30, «01:00» means
 * tonight, not this morning. `null` for a field that is not a time.
 */
export function nextOccurrence(time: string): string | null {
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  if (date.getTime() <= Date.now() - PLANNED_SESSION_GRACE_HOURS * 3_600_000) {
    date.setDate(date.getDate() + 1);
  }
  return date.toISOString();
}
