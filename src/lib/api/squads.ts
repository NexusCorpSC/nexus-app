import { apiRequest } from "@/lib/api-client";
import type {
  SquadMemberPatch,
  SquadRoleIcon,
  SquadView,
} from "@/types/nexus";

/**
 * The caller's squad, and the raid around it.
 *
 * No route takes a squad id: a user belongs to one squad at a time, so there is
 * only ever «mine», resolved from the session — and the raid comes from the
 * squad the same way.
 *
 * Every call answers the whole view, which is what lets the overlay show the
 * result of a click without waiting for its next poll.
 */

/** An empty raid pointer is `null`, never absent; older servers omit the key. */
function view(answer: Partial<SquadView>): SquadView {
  return { squad: answer.squad ?? null, raid: answer.raid ?? null };
}

export async function getMySquad(): Promise<SquadView> {
  return view(await apiRequest<Partial<SquadView>>("/api/squads"));
}

export async function createSquad(name?: string): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>("/api/squads", {
      method: "POST",
      body: { name },
    }),
  );
}

/** Whoever commands the squad. Everyone else reads the name. */
export async function renameSquad(name: string): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>("/api/squads", {
      method: "PATCH",
      body: { name },
    }),
  );
}

/** Matched case-insensitively by the API — a code is dictated as often as typed. */
export async function joinSquad(code: string): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>("/api/squads/join", {
      method: "POST",
      body: { code },
    }),
  );
}

export async function leaveSquad(): Promise<SquadView> {
  await apiRequest<Partial<SquadView>>("/api/squads/leave", { method: "POST" });
  return { squad: null, raid: null };
}

/** Own row, or anyone's when the caller commands the squad. Enforced server-side. */
export async function updateSquadMember(
  userId: string,
  patch: SquadMemberPatch,
): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(
      `/api/squads/members/${encodeURIComponent(userId)}`,
      { method: "PATCH", body: patch },
    ),
  );
}

/**
 * Puts a member out, which only whoever commands may do — and never on
 * themselves: a leader on the way out uses `leaveSquad`, which hands the squad
 * over.
 */
export async function removeSquadMember(userId: string): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(
      `/api/squads/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    ),
  );
}

/**
 * Hands the squad to another member. Open to lieutenants as well as the leader,
 * which is what «the same powers» means — and it does mean a lieutenant can take
 * the squad from whoever appointed them.
 */
export async function transferSquadLeadership(
  userId: string,
): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>("/api/squads/leader", {
      method: "PATCH",
      body: { userId },
    }),
  );
}

/** Whoever commands the squad writes it; everyone else reads it. */
export async function setSquadAnnouncements(
  announcements: string,
): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>("/api/squads/announcements", {
      method: "PATCH",
      body: { announcements },
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

/**
 * The squad's own list of jobs. There is no route to read them: they ride along
 * with the squad on every poll.
 *
 * The icon is one of `ROLE_ICON_GROUPS`; the API refuses anything else, since a
 * name this client cannot draw would leave a hole where the glyph should be.
 */
export async function createSquadRole(
  label: string,
  icon: SquadRoleIcon,
): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>("/api/squads/roles", {
      method: "POST",
      body: { label, icon },
    }),
  );
}

/** Base roles included: «Médic» is a suggestion, not a fact about the squad. */
export async function updateSquadRole(
  roleId: string,
  patch: { label?: string; icon?: SquadRoleIcon },
): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(
      `/api/squads/roles/${encodeURIComponent(roleId)}`,
      { method: "PATCH", body: patch },
    ),
  );
}

/** Never one of the seven the squad started with — the API refuses those. */
export async function deleteSquadRole(roleId: string): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(
      `/api/squads/roles/${encodeURIComponent(roleId)}`,
      { method: "DELETE" },
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Raids                                                               */
/* ------------------------------------------------------------------ */

/**
 * Several squads under one announcement.
 *
 * Two ranks: commanding your own squad is enough to take it into a raid or out
 * of one, while renaming the raid, writing its announcement and unlinking
 * somebody else's squad take commanding the raid's lead squad.
 */
export async function createRaid(name?: string): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>("/api/squads/raid", {
      method: "POST",
      body: { name },
    }),
  );
}

/** Links the caller's squad into the raid holding `code`. */
export async function joinRaid(code: string): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>("/api/squads/raid/join", {
      method: "POST",
      body: { code },
    }),
  );
}

/** Whoever commands the lead squad. The announcement is read by every raider. */
export async function updateRaid(patch: {
  name?: string;
  announcement?: string;
}): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>("/api/squads/raid", {
      method: "PATCH",
      body: patch,
    }),
  );
}

/**
 * Takes the caller's squad out of the raid. A departure rather than a
 * dissolution, even from the lead squad: the raid outlives it, the lead passing
 * to the longest-standing squad left.
 */
export async function leaveRaid(): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>("/api/squads/raid", {
      method: "DELETE",
    }),
  );
}

/** Puts another squad out of the raid. Whoever commands the lead squad. */
export async function unlinkRaidSquad(squadId: string): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(
      `/api/squads/raid/squads/${encodeURIComponent(squadId)}`,
      { method: "DELETE" },
    ),
  );
}
