import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { ApiError } from "@/lib/api-client";
import { readPlan, readStrokes } from "@/lib/api/plans";
import {
  inPlanOrder,
  type Plan,
  type PlanFeed,
  type PlanFeedEvent,
  type PlanPhase,
  type PlanStroke,
  type PlanSummary,
} from "@/types/nexus";

/**
 * The plan de vol, over the game.
 *
 * The stream is Rust's — one connection for the whole app — and lands here as
 * `plan://feed`: the **feed**, which is names, order, locks and a revision per
 * phase. The drawing is not in it. It is pulled by delta against those
 * revisions, and only for the phase actually on screen: an overlay holds one
 * layer, not a plan.
 *
 * **A cursor is the highest revision handed over, never the one the feed
 * announces.** A revision is published an instant before the stroke carrying it
 * is inserted, so a client that trusted the feed would step over the one still
 * in flight and never come back for it. Asking from what was actually received
 * makes that gap impossible; `RETRIES` covers the window while the insert
 * lands, and then gives up rather than holding the phase back for ever.
 *
 * Nothing is pulled while the window is hidden. It is created at startup and
 * its React tree runs long before anybody asks to see it — and losing focus is
 * not the same as being hidden, which over a game is the normal state.
 */

const PLAN_FEED_EVENT = "plan://feed";
const PLAN_VISIBILITY_EVENT = "plan://visibility";

const RETRIES = [150, 400, 1_000];

export interface PlanLayer {
  epoch: number;
  cursor: number;
  strokes: PlanStroke[];
}

const EMPTY_LAYER: PlanLayer = { epoch: 0, cursor: 0, strokes: [] };

export interface PlanState {
  /** Every live plan of the scope, as the feed last carried it. */
  plans: PlanSummary[];
  /** The plan on screen, in full — texts and all. */
  plan: Plan | null;
  /** Its phases, in the order the plan reads. */
  ordered: PlanPhase[];
  /** The phase on screen. */
  phase: PlanPhase | null;
  /** That phase's drawing. */
  layer: PlanLayer;
  visible: boolean;
  loading: boolean;
  /** Puts a trace on screen before its commit answers, and takes one off. */
  draw: (stroke: PlanStroke) => void;
  rub: (strokeId: string) => void;
  /** Re-reads the plan's texts — after a write, or when the feed moves them. */
  refresh: () => void;
}

/**
 * Which plan and which phase are on screen is resolved **here**, not by the
 * caller.
 *
 * The page cannot work it out on its own without a cycle: the phase to show
 * depends on the plan, the plan depends on the feed, and the feed is what this
 * hook holds. So the page says only what the *reader* chose — a plan they
 * picked, a phase they stepped to — and the defaults are filled in from the
 * feed: the plan being briefed, and the phase the presenter is on.
 */
export function usePlan(
  squadId: string | null,
  picked: { planId?: string | null; phaseId?: string | null } = {},
): PlanState {
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [layer, setLayer] = useState<PlanLayer>(EMPTY_LAYER);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);

  const gone = useRef(false);
  const pumping = useRef(false);
  const layerRef = useRef(layer);

  useEffect(() => {
    layerRef.current = layer;
  }, [layer]);

  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* The window                                                        */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    let dropped = false;
    let stop: (() => void) | undefined;

    void invoke<boolean>("is_plan_overlay_visible")
      .then((shown) => {
        if (!dropped) setVisible(shown);
      })
      .catch(() => undefined);

    void listen<boolean>(PLAN_VISIBILITY_EVENT, (event) => {
      if (!dropped) setVisible(event.payload);
    }).then((unlisten) => {
      if (dropped) unlisten();
      else stop = unlisten;
    });

    return () => {
      dropped = true;
      stop?.();
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* The feed                                                          */
  /* ---------------------------------------------------------------- */

  const takeFeed = useCallback(
    (feed: PlanFeed) => {
      setPlans(feed.plans);

      // The feed carries no texts, so the plan on screen keeps its own — but it
      // **must** take the summary's live fields, `rev` and `epoch` above all.
      // Keeping the loaded phases wholesale is the one mistake that breaks this
      // quietly: the revisions never move, the pump never notices anybody drew,
      // and the drawing stops arriving with nothing in any log.
      setPlan((current) => {
        if (!current) return current;

        const summary = feed.plans.find((one) => one.id === current.id);
        if (!summary) return current;

        const known = new Map(current.phases.map((phase) => [phase.id, phase]));

        return {
          ...current,
          ...summary,
          phases: summary.phases.map((live) => {
            const held = known.get(live.id);

            // A phase somebody just added: on screen at once, its texts filled
            // in by the next read.
            return held
              ? { ...held, ...live }
              : {
                  ...live,
                  objective: "",
                  points: [],
                  abort: "",
                  assignments: [],
                };
          }),
        };
      });
    },
    [],
  );

  useEffect(() => {
    let dropped = false;
    let stop: (() => void) | undefined;

    void invoke<PlanFeedEvent | null>("feed_snapshot", {
      topic: "plan",
      squad: squadId,
    })
      .then((snapshot) => {
        if (!dropped && snapshot) takeFeed(snapshot.view);
      })
      .catch(() => undefined);

    void listen<PlanFeedEvent>(PLAN_FEED_EVENT, (event) => {
      if (!dropped) takeFeed(event.payload.view);
    }).then((unlisten) => {
      if (dropped) unlisten();
      else stop = unlisten;
    });

    return () => {
      dropped = true;
      stop?.();
    };
  }, [squadId, takeFeed]);

  /* ---------------------------------------------------------------- */
  /* The plan                                                          */
  /* ---------------------------------------------------------------- */

  const planId = picked.planId ?? plans[0]?.id ?? null;

  const refresh = useCallback(() => {
    if (!planId) return;

    void readPlan(planId, squadId)
      .then((view) => {
        if (gone.current) return;
        setPlan(view.plan);
        setPlans(view.feed.plans);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!gone.current) setLoading(false);
      });
  }, [planId, squadId]);

  useEffect(() => {
    if (!planId || !visible) return;
    refresh();
  }, [planId, visible, refresh]);

  /* ---------------------------------------------------------------- */
  /* The drawing                                                       */
  /* ---------------------------------------------------------------- */

  const ordered = plan ? inPlanOrder(plan.phases) : [];

  const phaseId =
    picked.phaseId ?? plan?.presenter?.phaseId ?? ordered[0]?.id ?? null;

  const phase = ordered.find((one) => one.id === phaseId) ?? null;

  /** A phase switched is a different drawing; the layer starts empty. */
  useEffect(() => {
    layerRef.current = EMPTY_LAYER;
    setLayer(EMPTY_LAYER);
  }, [phaseId, planId]);

  const pump = useCallback(async () => {
    if (!planId || !phaseId || pumping.current) return;
    pumping.current = true;

    let cursor = layerRef.current.cursor;
    let epoch = layerRef.current.epoch;

    try {
      for (let attempt = 0; attempt <= RETRIES.length; attempt += 1) {
        if (gone.current) return;

        let delta;

        try {
          delta = await readStrokes(planId, phaseId, squadId, cursor, epoch);
        } catch (error) {
          // The phase was emptied under us: what we hold is gone.
          if (error instanceof ApiError && error.status === 409) {
            cursor = 0;
            epoch = epochOf(error) ?? epoch + 1;
            if (!gone.current) setLayer({ ...EMPTY_LAYER, epoch });
            continue;
          }

          return;
        }

        if (gone.current) return;

        setLayer((current) => apply(current, delta));

        const delivered = delta.strokes.reduce(
          (highest, stroke) => Math.max(highest, stroke.rev),
          cursor,
        );

        epoch = delta.epoch;
        cursor = delivered;

        if (delivered >= delta.rev) return;

        if (attempt < RETRIES.length) {
          await new Promise((resume) => setTimeout(resume, RETRIES[attempt]));
        }
      }

      // Given up on: a revision published for a stroke whose insert died. One
      // trace lost beats a phase that never catches up again.
      if (!gone.current) {
        setLayer((current) => ({
          ...current,
          cursor: Math.max(current.cursor, cursor),
        }));
      }
    } finally {
      pumping.current = false;
    }
  }, [phaseId, planId, squadId]);

  useEffect(() => {
    if (!visible || !phase) return;

    if (layerRef.current.epoch !== phase.epoch || phase.rev > layerRef.current.cursor) {
      void pump();
    }
  }, [visible, phase, pump, layer]);

  const draw = useCallback((stroke: PlanStroke) => {
    setLayer((current) => {
      const byId = new Map(current.strokes.map((one) => [one.id, one]));
      byId.set(stroke.id, stroke);

      return {
        ...current,
        strokes: [...byId.values()].sort((a, b) => a.rev - b.rev),
      };
    });
  }, []);

  const rub = useCallback((strokeId: string) => {
    setLayer((current) => ({
      ...current,
      strokes: current.strokes.filter((stroke) => stroke.id !== strokeId),
    }));
  }, []);

  return {
    plans,
    plan,
    ordered,
    phase,
    layer,
    visible,
    loading,
    draw,
    rub,
    refresh,
  };
}

function apply(layer: PlanLayer, delta: { epoch: number; strokes: PlanStroke[] }): PlanLayer {
  const byId = new Map(layer.strokes.map((stroke) => [stroke.id, stroke]));
  let cursor = layer.cursor;

  for (const stroke of delta.strokes) {
    cursor = Math.max(cursor, stroke.rev);

    // A tombstone is a removal that travelled, not a stroke to draw.
    if (stroke.deletedAt) byId.delete(stroke.id);
    else byId.set(stroke.id, stroke);
  }

  return {
    epoch: delta.epoch,
    cursor,
    strokes: [...byId.values()].sort((a, b) => a.rev - b.rev),
  };
}

/** The epoch a 409 names, so the layer restarts in the right one. */
function epochOf(error: ApiError): number | null {
  const epoch = (error.body as { epoch?: unknown } | null)?.epoch;
  return typeof epoch === "number" ? epoch : null;
}
