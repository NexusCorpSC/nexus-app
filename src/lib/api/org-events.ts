import { apiRequest } from "@/lib/api-client";
import type {
  OrgEventList,
  OrgEventRegistrationInput,
  OrgEventSquadResult,
  OrgEventView,
} from "@/types/nexus";

/**
 * Organization events (see `lib/org-events.ts` in Nexus Tools). Reading and
 * registering happen here; planning or editing one stays on the site.
 */

function eventPath(orgId: string, eventId: string) {
  return `/api/orgs/${encodeURIComponent(orgId)}/events/${encodeURIComponent(eventId)}`;
}

/**
 * The events overlapping `[from, to[`, earliest first. `from` defaults to a
 * day ago on the server, `to` to no bound. Members see them all, anyone else
 * the public ones.
 */
export async function listOrgEvents(
  orgId: string,
  range: { from?: string; to?: string } = {},
) {
  return (
    await apiRequest<OrgEventList>(
      `/api/orgs/${encodeURIComponent(orgId)}/events`,
      { params: range },
    )
  ).events;
}

/** One event; a private one answers 404 to anyone but members. */
export function getOrgEvent(orgId: string, eventId: string) {
  return apiRequest<OrgEventView>(eventPath(orgId, eventId));
}

/**
 * Registers the reader, or updates their registration — a withdrawn one comes
 * back. Members only, until the event ends.
 */
export function registerToOrgEvent(
  orgId: string,
  eventId: string,
  input: OrgEventRegistrationInput,
) {
  return apiRequest<OrgEventView>(`${eventPath(orgId, eventId)}/registration`, {
    method: "PUT",
    body: input,
  });
}

/** Withdraws the reader; their answers are kept, out of the counts. */
export function withdrawFromOrgEvent(orgId: string, eventId: string) {
  return apiRequest<OrgEventView>(`${eventPath(orgId, eventId)}/registration`, {
    method: "DELETE",
  });
}

/**
 * Builds the event's squad, led by the reader, with every active registrant
 * in it. Its creator and the organization's editors only; 409 while the squad
 * exists, or when nobody is registered.
 */
export function createOrgEventSquad(orgId: string, eventId: string) {
  return apiRequest<OrgEventSquadResult>(`${eventPath(orgId, eventId)}/squad`, {
    method: "POST",
  });
}
