import { apiRequest } from "@/lib/api-client";
import type { MyPresence, MyUpcomingEvent, OrgPresence } from "@/types/nexus";

export function getMyPresence() {
  return apiRequest<MyPresence>("/api/me/presence");
}

/**
 * Declares playing, or renews the declaration.
 *
 * `undefined` sends no activity at all, which the server reads as «keep it»:
 * the running session's when renewing, the planned session's when starting
 * one — `null` would wipe either.
 */
export function declarePlaying(activity: string | null | undefined) {
  return apiRequest<MyPresence>("/api/me/presence", {
    method: "PUT",
    body: activity === undefined ? {} : { activity },
  });
}

export function stopPlaying() {
  return apiRequest<MyPresence>("/api/me/presence", { method: "DELETE" });
}

/**
 * Plans the next session, or replaces the planned one. With `event` — an
 * upcoming event the reader is registered to — the time and activity default
 * to its start and title; without, `at` is required. Answers the whole
 * presence.
 */
export function planSession(input: {
  at?: string;
  activity?: string | null;
  event?: { orgId: string; eventId: string };
}) {
  return apiRequest<MyPresence>("/api/me/presence/planned", {
    method: "PUT",
    body: input,
  });
}

/** Cancels the planned session. Idempotent; answers the whole presence. */
export function cancelPlannedSession() {
  return apiRequest<MyPresence>("/api/me/presence/planned", {
    method: "DELETE",
  });
}

/** The upcoming events the reader is registered to, soonest first. */
export async function listMyUpcomingEvents() {
  return (await apiRequest<{ events: MyUpcomingEvent[] }>("/api/me/events"))
    .events;
}

/** The members of an organization currently playing. Members only. */
export function getOrgPresence(orgId: string) {
  return apiRequest<OrgPresence>(
    `/api/orgs/${encodeURIComponent(orgId)}/presence`,
  );
}
