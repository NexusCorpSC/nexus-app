import { apiRequest } from "@/lib/api-client";
import type {
  SquadMemberPatch,
  SquadRoleIcon,
  SquadView,
} from "@/types/nexus";

/**
 * The caller's squad, and the raid around it.
 *
 * A user is in one squad nearly always, and every route resolves «mine» from
 * the session. A raid's organiser may be in several — the squads they opened
 * for the raid, led until somebody takes them over — so every call here says
 * which squad it means with `?squad=<id>`; `null` leaves the choice to the API,
 * which picks the longest-standing membership. That is what an ordinary player
 * gets either way.
 *
 * Every call answers the whole view, which is what lets the overlay show the
 * result of a click without waiting for its next poll.
 */

/** The route, addressed to one squad — or to «mine» when there is only one. */
function at(path: string, squadId: string | null): string {
  return squadId ? `${path}?squad=${encodeURIComponent(squadId)}` : path;
}

/**
 * An empty raid pointer is `null`, never absent; older servers omit the key —
 * and older servers still know nothing of memberships, in which case the one
 * squad they answer is the whole list.
 */
export function view(answer: Partial<SquadView>): SquadView {
  const squad = answer.squad ?? null;

  return {
    squad,
    raid: answer.raid ?? null,
    memberships:
      answer.memberships ??
      (squad
        ? [
            {
              id: squad.id,
              name: squad.name,
              code: squad.code,
              raidId: squad.raidId ?? null,
            },
          ]
        : []),
  };
}

export async function getMySquad(squadId: string | null): Promise<SquadView> {
  return view(await apiRequest<Partial<SquadView>>(at("/api/squads", squadId)));
}

/** Starting over: every squad the caller was in is left first. */
export async function createSquad(name?: string): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>("/api/squads", {
      method: "POST",
      body: { name },
    }),
  );
}

/** Whoever commands the squad. Everyone else reads the name. */
export async function renameSquad(
  squadId: string,
  name: string,
): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(at("/api/squads", squadId), {
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

/**
 * Leaves one squad. The answer is what the caller is still in: nothing, for
 * almost everyone; the squad they came from, for an organiser leaving one they
 * opened.
 */
export async function leaveSquad(squadId: string): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(at("/api/squads/leave", squadId), {
      method: "POST",
    }),
  );
}

/** Own row, or anyone's when the caller commands the squad. Enforced server-side. */
export async function updateSquadMember(
  squadId: string,
  userId: string,
  patch: SquadMemberPatch,
): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(
      at(`/api/squads/members/${encodeURIComponent(userId)}`, squadId),
      { method: "PATCH", body: patch },
    ),
  );
}

/**
 * Puts a member out, which only whoever commands may do — and never on
 * themselves: a leader on the way out uses `leaveSquad`, which hands the squad
 * over.
 */
export async function removeSquadMember(
  squadId: string,
  userId: string,
): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(
      at(`/api/squads/members/${encodeURIComponent(userId)}`, squadId),
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
  squadId: string,
  userId: string,
): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(at("/api/squads/leader", squadId), {
      method: "PATCH",
      body: { userId },
    }),
  );
}

/** Whoever commands the squad writes it; everyone else reads it. */
export async function setSquadAnnouncements(
  squadId: string,
  announcements: string,
): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(
      at("/api/squads/announcements", squadId),
      { method: "PATCH", body: { announcements } },
    ),
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
  squadId: string,
  label: string,
  icon: SquadRoleIcon,
): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(at("/api/squads/roles", squadId), {
      method: "POST",
      body: { label, icon },
    }),
  );
}

/** Base roles included: «Médic» is a suggestion, not a fact about the squad. */
export async function updateSquadRole(
  squadId: string,
  roleId: string,
  patch: { label?: string; icon?: SquadRoleIcon },
): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(
      at(`/api/squads/roles/${encodeURIComponent(roleId)}`, squadId),
      { method: "PATCH", body: patch },
    ),
  );
}

/** Never one of the seven the squad started with — the API refuses those. */
export async function deleteSquadRole(
  squadId: string,
  roleId: string,
): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(
      at(`/api/squads/roles/${encodeURIComponent(roleId)}`, squadId),
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
 * of one, while renaming the raid, writing its announcement, unlinking somebody
 * else's squad and opening a new one take commanding the raid's lead squad.
 */
export async function createRaid(
  squadId: string,
  name?: string,
): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(at("/api/squads/raid", squadId), {
      method: "POST",
      body: { name },
    }),
  );
}

/** Links the squad into the raid holding `code`. */
export async function joinRaid(
  squadId: string,
  code: string,
): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(at("/api/squads/raid/join", squadId), {
      method: "POST",
      body: { code },
    }),
  );
}

/** Whoever commands the lead squad. The announcement is read by every raider. */
export async function updateRaid(
  squadId: string,
  patch: { name?: string; announcement?: string },
): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(at("/api/squads/raid", squadId), {
      method: "PATCH",
      body: patch,
    }),
  );
}

/**
 * Takes the squad out of the raid. A departure rather than a dissolution, even
 * from the lead squad: the raid outlives it, the lead passing to the
 * longest-standing squad left.
 */
export async function leaveRaid(squadId: string): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(at("/api/squads/raid", squadId), {
      method: "DELETE",
    }),
  );
}

/** Puts another squad out of the raid. Whoever commands the lead squad. */
export async function unlinkRaidSquad(
  squadId: string,
  targetSquadId: string,
): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(
      at(
        `/api/squads/raid/squads/${encodeURIComponent(targetSquadId)}`,
        squadId,
      ),
      { method: "DELETE" },
    ),
  );
}

/**
 * Opens another squad in the raid, the caller leading it — and staying in the
 * one they asked from. Whoever commands the lead squad.
 *
 * The answer is still the view of the squad asked from: the new one is in
 * `raid.squads` and in `memberships`, and switching to it is the overlay's
 * call.
 */
export async function createRaidSquad(
  squadId: string,
  name?: string,
): Promise<SquadView> {
  return view(
    await apiRequest<Partial<SquadView>>(
      at("/api/squads/raid/squads", squadId),
      { method: "POST", body: { name } },
    ),
  );
}
