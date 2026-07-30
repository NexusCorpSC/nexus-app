import { apiRequest } from "@/lib/api-client";
import type { Squad, SquadMemberPatch } from "@/types/nexus";

/**
 * The caller's squad. No route takes a squad id: a user belongs to one squad at
 * a time, so there is only ever «mine», resolved from the session.
 *
 * Every mutation answers with the whole squad, which is what lets the overlay
 * show the result of a click without waiting for its next poll.
 */

type SquadResponse = { squad: Squad | null };

export async function getMySquad(): Promise<Squad | null> {
  const { squad } = await apiRequest<SquadResponse>("/api/squads");
  return squad;
}

export async function createSquad(name?: string): Promise<Squad> {
  const { squad } = await apiRequest<{ squad: Squad }>("/api/squads", {
    method: "POST",
    body: { name },
  });

  return squad;
}

/** Matched case-insensitively by the API — a code is dictated as often as typed. */
export async function joinSquad(code: string): Promise<Squad> {
  const { squad } = await apiRequest<{ squad: Squad }>("/api/squads/join", {
    method: "POST",
    body: { code },
  });

  return squad;
}

export async function leaveSquad(): Promise<null> {
  await apiRequest<SquadResponse>("/api/squads/leave", { method: "POST" });
  return null;
}

/** Own row, or anyone's when the caller leads the squad. Enforced server-side. */
export async function updateSquadMember(
  userId: string,
  patch: SquadMemberPatch,
): Promise<Squad> {
  const { squad } = await apiRequest<{ squad: Squad }>(
    `/api/squads/members/${encodeURIComponent(userId)}`,
    { method: "PATCH", body: patch },
  );

  return squad;
}

/**
 * Puts a member out, which only the leader may do — and never on themselves:
 * a leader on the way out uses `leaveSquad`, which hands the squad over.
 */
export async function removeSquadMember(userId: string): Promise<Squad> {
  const { squad } = await apiRequest<{ squad: Squad }>(
    `/api/squads/members/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );

  return squad;
}

/** The leader alone; everyone else reads it. */
export async function setSquadAnnouncements(
  announcements: string,
): Promise<Squad> {
  const { squad } = await apiRequest<{ squad: Squad }>(
    "/api/squads/announcements",
    { method: "PATCH", body: { announcements } },
  );

  return squad;
}
