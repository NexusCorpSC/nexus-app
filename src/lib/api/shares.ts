import { apiRequest } from "@/lib/api-client";
import type {
  InvitationsResponse,
  ShareCandidate,
  ShareKind,
  SharePanelData,
} from "@/types/nexus";

/**
 * Sharing an event or a private place with given players, and an event's
 * share link (see `lib/shares.ts` in Nexus Tools). Those who manage the
 * object only; the invitations a player received are theirs.
 */

function sharePath(kind: ShareKind, id: string) {
  return `/api/shares/${kind}/${encodeURIComponent(id)}`;
}

export function getSharePanel(kind: ShareKind, id: string) {
  return apiRequest<SharePanelData>(sharePath(kind, id));
}

/** Invites that player: access at once, and a notification for them. */
export function inviteToShare(kind: ShareKind, id: string, userId: string) {
  return apiRequest<SharePanelData>(sharePath(kind, id), {
    method: "POST",
    body: { userId },
  });
}

export function removeFromShare(kind: ShareKind, id: string, userId: string) {
  return apiRequest<SharePanelData>(sharePath(kind, id), {
    method: "DELETE",
    params: { userId },
  });
}

/** A new share link: the previous one stops working. Events only. */
export function renewShareLink(kind: ShareKind, id: string) {
  return apiRequest<SharePanelData>(`${sharePath(kind, id)}/link`, {
    method: "POST",
  });
}

export function disableShareLink(kind: ShareKind, id: string) {
  return apiRequest<SharePanelData>(`${sharePath(kind, id)}/link`, {
    method: "DELETE",
  });
}

/** Players whose name starts with `query`, friends first; friends only without it. */
export async function searchShareCandidates(
  query: string,
  target?: { kind: ShareKind; id: string },
) {
  return (
    await apiRequest<{ candidates: ShareCandidate[] }>(
      "/api/shares/candidates",
      { params: { q: query, ...(target ?? {}) } },
    )
  ).candidates;
}

/** The invitations received, newest first, and how many are unseen. */
export function getInvitations() {
  return apiRequest<InvitationsResponse>("/api/me/invitations");
}

/** Every invitation is seen. */
export function markInvitationsSeen() {
  return apiRequest<void>("/api/me/invitations", { method: "POST" });
}

/** The reader gives up something shared with them: they no longer see it. */
export function leaveShare(kind: ShareKind, id: string) {
  return apiRequest<void>(
    `/api/me/shares/${kind}/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

/** Declines an invitation: the event or place is no longer shown. */
export function declineInvitation(id: string) {
  return apiRequest<void>(`/api/me/invitations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
