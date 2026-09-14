import { apiRequest } from "@/lib/api-client";
import type {
  PlanInk,
  PlanStroke,
  PlanView,
  StrokeDash,
  StrokeDelta,
  StrokeKind,
} from "@/types/nexus";

/**
 * The plans de vol of the caller's scope — a squad's, or the raid it is in.
 *
 * The overlay reads, and draws a little. Following a briefing and correcting a
 * line over the cockpit is what it is for; composing a plan is not, and there
 * is a button to the site for that. So this is the read half of the API plus
 * the two writes a pen needs, and no more.
 *
 * `squadId` says which of the caller's squads is meant — it decides whether the
 * plans they see are their squad's or their raid's — and `null` leaves the
 * choice to the API, as everywhere else.
 */

const PLANS = "/api/squads/plans";

function at(squadId: string | null) {
  return squadId ? { squad: squadId } : undefined;
}

export function readPlan(
  planId: string,
  squadId: string | null,
): Promise<PlanView> {
  return apiRequest<PlanView>(`${PLANS}/${planId}`, { params: at(squadId) });
}

/**
 * Everything drawn on a phase above a revision.
 *
 * `since` is what this client was handed, never what the feed announced: a
 * revision is published an instant before the stroke carrying it is inserted,
 * so trusting the feed would step over the one still in flight and never come
 * back for it.
 *
 * A phase that was emptied answers **409**, which arrives as an `ApiError` of
 * that status: the layer is thrown away and asked for again from zero.
 */
export function readStrokes(
  planId: string,
  phaseId: string,
  squadId: string | null,
  since: number,
  epoch: number,
): Promise<StrokeDelta> {
  return apiRequest<StrokeDelta>(
    `${PLANS}/${planId}/phases/${phaseId}/strokes`,
    { params: { since, epoch, ...(squadId ? { squad: squadId } : {}) } },
  );
}

/**
 * One trace, at the pen's lift.
 *
 * `clientId` is minted before the request so that a commit retried after a
 * timeout — which is what a hangar wifi produces — is recognised and handed
 * back rather than drawn twice.
 */
export function commitStroke(
  planId: string,
  phaseId: string,
  squadId: string | null,
  stroke: {
    clientId: string;
    kind: StrokeKind;
    ink: PlanInk;
    width: number;
    /** Absent is legal and means solid; the overlay carries no picker. */
    dash?: StrokeDash;
    points: number[];
    text?: string;
  },
): Promise<{ stroke: PlanStroke }> {
  return apiRequest<{ stroke: PlanStroke }>(
    `${PLANS}/${planId}/phases/${phaseId}/strokes`,
    { method: "POST", params: at(squadId), body: stroke },
  );
}

/** Rubs one trace out. The server refuses anyone else's unless you run the plan. */
export function eraseStroke(
  planId: string,
  phaseId: string,
  strokeId: string,
  squadId: string | null,
): Promise<{ stroke: PlanStroke }> {
  return apiRequest<{ stroke: PlanStroke }>(
    `${PLANS}/${planId}/phases/${phaseId}/strokes/${strokeId}`,
    { method: "DELETE", params: at(squadId) },
  );
}

/**
 * Raises the tombstone: the trace comes back with the id it always had, under a
 * fresh revision.
 *
 * This is the whole of «annuler». An erase leaves the record behind rather than
 * deleting it, so taking the gesture back is one flag — no second identity for
 * the same trace, and nothing for the other members to learn: a resurrection
 * reaches them as a stroke with a new revision that is no longer dead, which
 * `apply()` already puts back on the map.
 */
export function restoreStroke(
  planId: string,
  phaseId: string,
  strokeId: string,
  squadId: string | null,
): Promise<{ stroke: PlanStroke }> {
  return apiRequest<{ stroke: PlanStroke }>(
    `${PLANS}/${planId}/phases/${phaseId}/strokes/${strokeId}`,
    { method: "PATCH", params: at(squadId), body: { restore: true } },
  );
}
