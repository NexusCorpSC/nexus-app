import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { ApiError } from "@/lib/api-client";
import { listPlans, readPlan, readStrokes } from "@/lib/api/plans";
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
 *
 * **Which squad is the stream's to say, not this window's.** There is one
 * stream for the whole app and one squad it is opened for; this window has no
 * selector of its own, it shows the plans of whatever squad the app is on. So
 * the squad each feed is tagged with is *adopted* — and used for the HTTP reads
 * that follow — rather than checked against a value this window worked out on
 * its own. Filtering on such a value is what left the window saying «aucun plan
 * de vol» for ever: the stream is opened for a selection, where `null` means
 * «the API's pick», and comparing that against the id the API in fact picked
 * never matched.
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
  /**
   * The squad the feed was read for, as the stream tags it — `null` when the
   * stream left the choice to the API. It is what every read here passes on,
   * so the window and the stream can never be looking at two different scopes.
   */
  squad: string | null;
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
  picked: { planId?: string | null; phaseId?: string | null } = {},
): PlanState {
  const [squadId, setSquadId] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [layer, setLayer] = useState<PlanLayer>(EMPTY_LAYER);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);

  const gone = useRef(false);

  /**
   * The plan and phase the one live layer belongs to, and the pump that owns
   * it.
   *
   * An overlay holds a single layer rather than one per phase, so a read still
   * in flight when the reader steps on would pour the old phase's strokes into
   * the new phase's empty layer. The pump carries the key it started for and
   * checks it after every await; a pump for another key may start at once,
   * because the stale one is about to notice and stop.
   */
  const pumping = useRef<string | null>(null);
  const showing = useRef("");
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

    // Rust only hands back a snapshot taken for the squad it is asked about,
    // and this window has nothing to ask with until a feed has told it. So it
    // asks for the stream's default and, failing that, reads the feed over
    // HTTP — which is also what saves it when the stream connected before this
    // window existed, or is on a squad chosen in another window.
    void invoke<PlanFeedEvent | null>("feed_snapshot", {
      topic: "plan",
      squad: null,
    })
      .then((snapshot) => {
        if (dropped) return null;

        if (snapshot) {
          setSquadId(snapshot.squad);
          takeFeed(snapshot.view);
          return null;
        }

        return listPlans(null).then((view) => {
          if (!dropped) takeFeed(view.feed);
        });
      })
      .catch(() => undefined);

    void listen<PlanFeedEvent>(PLAN_FEED_EVENT, (event) => {
      // The payload names the squad it was read for, and that is not
      // decoration: which squad is being looked at decides whether the plans
      // are the squad's or the raid's. This window has no squad of its own to
      // check it against, so it takes the stream's — and every read below goes
      // out under it.
      if (dropped) return;

      setSquadId(event.payload.squad);
      takeFeed(event.payload.view);
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
    showing.current = `${planId ?? ""}:${phaseId ?? ""}`;
    layerRef.current = EMPTY_LAYER;
    setLayer(EMPTY_LAYER);
  }, [phaseId, planId]);

  const pump = useCallback(async () => {
    if (!planId || !phaseId) return;

    const key = `${planId}:${phaseId}`;
    if (pumping.current === key) return;
    pumping.current = key;

    /** Still the layer on screen? A stale pump writes nowhere. */
    const current = () => !gone.current && showing.current === key;

    let cursor = layerRef.current.cursor;
    let epoch = layerRef.current.epoch;

    try {
      for (let attempt = 0; attempt <= RETRIES.length; attempt += 1) {
        if (!current()) return;

        let delta;

        try {
          delta = await readStrokes(planId, phaseId, squadId, cursor, epoch);
        } catch (error) {
          // The phase was emptied under us: what we hold is gone.
          if (error instanceof ApiError && error.status === 409) {
            cursor = 0;
            epoch = epochOf(error) ?? epoch + 1;
            if (current()) setLayer({ ...EMPTY_LAYER, epoch });
            continue;
          }

          return;
        }

        if (!current()) return;

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
      if (current()) {
        setLayer((current) => ({
          ...current,
          cursor: Math.max(current.cursor, cursor),
        }));
      }
    } finally {
      // Only if nobody started a newer one in the meantime.
      if (pumping.current === key) pumping.current = null;
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
    squad: squadId,
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
