import { openUrl } from "@tauri-apps/plugin-opener";
import { formatTime } from "@/lib/presence";
import { getApiBaseUrl } from "@/lib/settings";
import type { OrgEventRole, OrgEventView } from "@/types/nexus";

/**
 * What the event screens share: role counts, what is missing, and the way to
 * the site for what this app leaves to it — planning, editing, the
 * organizer's summary.
 */

export function roleById(
  roles: OrgEventRole[],
  id: string,
): OrgEventRole | null {
  return roles.find((role) => role.id === id) ?? null;
}

/** How many the role still lacks to reach its target; 0 without one. */
export function missingFor(
  role: OrgEventRole,
  counts: Record<string, number>,
): number {
  return role.wanted === null
    ? 0
    : Math.max(0, role.wanted - (counts[role.id] ?? 0));
}

/** The roles whose target is not reached, and by how many. */
export function missingRoles(
  event: Pick<OrgEventView, "roles" | "roleCounts">,
): { role: OrgEventRole; missing: number }[] {
  return event.roles
    .map((role) => ({ role, missing: missingFor(role, event.roleCounts) }))
    .filter(({ missing }) => missing > 0);
}

/** Registered and not withdrawn. */
export function isRegistered(event: OrgEventView): boolean {
  return !!event.myRegistration && !event.myRegistration.withdrawn;
}

/** «Aucun inscrit», «1 inscrit», «3 inscrits». */
export function registrationsLabel(count: number): string {
  if (count === 0) return "Aucun inscrit";
  return `${count} ${count > 1 ? "inscrits" : "inscrit"}`;
}

/** «21:00 → 23:30», in the reader's time zone. */
export function formatTimeRange(event: { startsAt: string; endsAt: string }) {
  return `${formatTime(event.startsAt)} → ${formatTime(event.endsAt)}`;
}

/** «2 h 30», «45 min»: how long an event lasts. */
export function formatSpan(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest ? `${hours} h ${String(rest).padStart(2, "0")}` : `${hours} h`;
}

/** «Paris» for Europe/Paris: what the reader recognises of their time zone. */
export function timeZoneCity(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  return (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}

/** Opens a page of the configured site in the browser. */
export async function openOnSite(path: string): Promise<void> {
  const baseUrl = await getApiBaseUrl();
  await openUrl(`${baseUrl}${path}`);
}
