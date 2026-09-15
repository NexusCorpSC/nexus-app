import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  ExternalLink,
  Lock,
  MoreHorizontal,
  Pencil,
  Redo2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

import { useAuth } from "@/auth/auth-context";
import { OverlayLockButton } from "@/components/overlay-lock-button";
import { OverlayOpacityButton } from "@/components/overlay-opacity-button";
import { PlanCanvas } from "@/components/plan/plan-canvas";
import { useOverlayLocked } from "@/hooks/use-overlay-lock";
import { useOverlayMode } from "@/hooks/use-overlay-opacity";
import { usePlan } from "@/hooks/use-plan";
import { useSquad } from "@/hooks/use-squad";
import { useTransparentWindow } from "@/hooks/use-transparent-window";
import {
  clearPhase,
  commitStroke,
  eraseStroke,
  removePhase,
  restoreStroke,
} from "@/lib/api/plans";
import { overlaySkin } from "@/lib/overlay-opacity";
import { commandsSquad, governsPlan, leadsRaid } from "@/lib/squad-rank";
import { forStorage } from "@/lib/plan-geometry";
import { getApiBaseUrl } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { formatClock, phaseStartSec, type PlanStroke } from "@/types/nexus";

/**
 * The plan de vol, over the game.
 *
 * Not the editor. Composing a briefing is done at the table, on the site, where
 * there is a mouse and a screen; what this window is for is the three things a
 * pilot needs mid-drop — which phase the briefing is on, what that phase asks
 * of *them*, and the drawing itself — plus a pen for the one correction that
 * cannot wait.
 *
 * **Locked, it is a picture the cursor goes through**, which is what an
 * always-on-top window over a cockpit should be, and why the pen is offered
 * only while it is unlocked. That is not a limitation worked around: a window
 * that took the mouse while locked would be taking it from the game.
 *
 * The one correction comes with a way to take it back. `Mark` is this window's
 * own memory of what it did, this session, to its own traces — never a history
 * of the plan: erasing leaves a tombstone, so undoing is raising it and the
 * trace keeps the id it always had.
 */

/** One thing this window did to one phase, and enough to take it back. */
interface Mark {
  act: "draw" | "erase";
  phaseId: string;
  /** The epoch it happened in. A phase emptied since makes it meaningless. */
  epoch: number;
  strokeId: string;
  stroke: PlanStroke;
}
export default function PlanOverlayPage() {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;

  useTransparentWindow();

  const mode = useOverlayMode("plan");
  const locked = useOverlayLocked("plan");

  const { state } = useSquad(true, null, userId);

  /**
   * The squad this member's own traces wear the colours of.
   *
   * Not the same question as «which squad are the plans read for» — that one is
   * the stream's to answer, and `usePlan` takes it from the feed's own tag.
   * This one is only the ink.
   */
  const mySquadId = state.squad?.id ?? null;

  /** What the reader chose; everything else is the briefing's own. */
  const [stepped, setStepped] = useState<string | null>(null);
  const [tool, setTool] = useState<"none" | "pen" | "eraser">("none");

  /** What this window did, and what it has taken back. Never persisted. */
  const [done, setDone] = useState<Mark[]>([]);
  const [undone, setUndone] = useState<Mark[]>([]);
  const [stepping, setStepping] = useState(false);

  /** Le tiroir des actions de phase, et ce qu'un refus a répondu. */
  const [acting, setActing] = useState(false);
  const [working, setWorking] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const {
    squad: squadId,
    plans,
    plan,
    ordered,
    phase,
    layer,
    draw,
    rub,
    refresh,
  } = usePlan({ phaseId: stepped });

  const presenter = plan?.presenter ?? null;
  const mine =
    phase && userId
      ? (phase.assignments.find((one) => one.userId === userId) ?? null)
      : null;

  const drawable = !locked && phase !== null && !phase.locked;

  /**
   * Qui tient ce plan, au sens où l'API l'entend.
   *
   * Une politesse, pas une règle : le serveur refuse de toute façon. Mais
   * offrir un bouton qui sera refusé n'est pas mieux que de le cacher, et une
   * phase supprimée par mégarde ne se récupère pas.
   */
  const governs =
    plan && userId
      ? governsPlan(plan.scope, {
          commands: state.squad ? commandsSquad(state.squad, userId) : false,
          leads: leadsRaid(state.raid ?? null, userId),
        })
      : false;

  // Verrouiller referme le tiroir pour de bon : la fenêtre ne prend plus la
  // souris, et il reviendrait ouvert au déverrouillage.
  useEffect(() => {
    if (locked) {
      setActing(false);
      setRefused(null);
    }
  }, [locked]);

  /**
   * Défaire une phase — la vider, ou l'ôter du plan.
   *
   * Ni l'une ni l'autre ne se reprend : c'est pourquoi chaque bouton demande
   * deux fois, et pourquoi le refus du serveur est montré ici plutôt qu'avalé.
   * Les deux piles de marques repartent à zéro — elles désignent des traces que
   * plus rien ne porte.
   */
  const actOnPhase = useCallback(
    async (act: "clear" | "remove") => {
      if (!plan || !phase || working) return;

      setWorking(true);
      setRefused(null);

      try {
        if (act === "clear") {
          await clearPhase(plan.id, phase.id, squadId);
        } else {
          await removePhase(plan.id, phase.id, squadId);
          // La phase visée n'existe plus : y rester laisserait la fenêtre sur
          // un identifiant que le plan ne connaît plus, donc sur du vide. On
          // rend le choix au briefing, qui retombe sur la phase menée.
          setStepped(null);
        }

        setDone([]);
        setUndone([]);
        setActing(false);
        refresh();
      } catch (error) {
        setRefused(
          error instanceof Error ? error.message : "Le serveur a refusé.",
        );
      } finally {
        setWorking(false);
      }
    },
    [phase, plan, refresh, squadId, working],
  );

  const mark = useCallback((held: Mark) => {
    setDone((current) => [...current, held].slice(-20));
    // A new gesture is a new future: what was undone is not coming back.
    setUndone([]);
  }, []);

  const step = useCallback(
    (by: number) => {
      if (!phase) return;

      const at = ordered.findIndex((one) => one.id === phase.id);
      const next = ordered[Math.max(0, Math.min(ordered.length - 1, at + by))];
      if (next) setStepped(next.id);
    },
    [ordered, phase],
  );

  const onDraw = useCallback(
    async (points: number[]) => {
      if (!plan || !phase) return;

      const stored = forStorage(points);
      const clientId = crypto.randomUUID().replace(/-/g, "");

      // On screen before the round trip, under an id of its own — the server
      // mints the real one, so the commit's answer is what replaces it.
      const optimistic: PlanStroke = {
        id: `local-${clientId}`,
        phaseId: phase.id,
        epoch: phase.epoch,
        rev: Number.MAX_SAFE_INTEGER,
        clientId,
        authorId: userId ?? "",
        authorName: user?.name ?? "",
        squadId: mySquadId ?? "",
        kind: "pen",
        ink: "squad",
        width: 6,
        dash: "solid",
        points: stored,
        text: "",
        tokenUserId: "",
        deletedAt: null,
        createdAt: new Date().toISOString(),
      };

      draw(optimistic);

      try {
        const { stroke } = await commitStroke(plan.id, phase.id, squadId, {
          clientId,
          kind: "pen",
          ink: "squad",
          width: 6,
          points: stored,
        });

        rub(optimistic.id);
        draw(stroke);
        mark({
          act: "draw",
          phaseId: phase.id,
          epoch: phase.epoch,
          strokeId: stroke.id,
          stroke,
        });
      } catch {
        rub(optimistic.id);
      }
    },
    [draw, mark, mySquadId, phase, plan, rub, squadId, user?.name, userId],
  );

  const onErase = useCallback(
    async (strokeId: string) => {
      if (!plan || !phase) return;

      const held = layer.strokes.find((stroke) => stroke.id === strokeId);
      rub(strokeId);

      if (!held || strokeId.startsWith("local-")) return;

      try {
        await eraseStroke(plan.id, phase.id, strokeId, squadId);

        // Only your own goes on your stack: the server refuses to bring back
        // somebody else's, so offering the button would be a lie.
        if (held.authorId === userId) {
          mark({
            act: "erase",
            phaseId: phase.id,
            epoch: phase.epoch,
            strokeId,
            stroke: held,
          });
        }
      } catch {
        draw(held);
      }
    },
    [draw, layer.strokes, mark, phase, plan, rub, squadId, userId],
  );

  /**
   * Whether a mark still describes reality.
   *
   * Derived at render rather than cleaned up by a listener: a phase stepped
   * away from, a phase somebody emptied — the epoch moved — and a trace a
   * leader took first all make a mark simply stop being eligible, with nothing
   * to remember to clear.
   */
  const present = useMemo(
    () => new Set(layer.strokes.map((stroke) => stroke.id)),
    [layer.strokes],
  );

  const fits = useCallback(
    (held: Mark | undefined): held is Mark =>
      Boolean(
        held &&
          phase &&
          held.phaseId === phase.id &&
          held.epoch === phase.epoch &&
          (held.act === "draw"
            ? present.has(held.strokeId)
            : !present.has(held.strokeId)),
      ),
    [phase, present],
  );

  const canUndo = drawable && !stepping && fits(done[done.length - 1]);
  const canRedo = drawable && !stepping && fits(undone[undone.length - 1]);

  const walk = useCallback(
    async (backwards: boolean) => {
      if (!plan || !phase || stepping) return;

      const from = backwards ? done : undone;
      const held = from[from.length - 1];
      if (!fits(held)) return;

      // Undoing a `draw` takes it off; undoing an `erase` puts it back. Redo is
      // the same sentence the other way round.
      const off = backwards ? held.act === "draw" : held.act === "erase";

      setStepping(true);

      if (off) rub(held.strokeId);
      else
        // A trace brought back is the newest thing on the phase: a revision is
        // what orders a drawing, so it goes on top and the server's answer,
        // carrying its real one, replaces it.
        draw({ ...held.stroke, deletedAt: null, rev: Number.MAX_SAFE_INTEGER });

      try {
        const answer = off
          ? await eraseStroke(plan.id, held.phaseId, held.strokeId, squadId)
          : await restoreStroke(plan.id, held.phaseId, held.strokeId, squadId);

        if (!off) draw(answer.stroke);

        setDone((current) =>
          backwards ? current.slice(0, -1) : [...current, held],
        );
        setUndone((current) =>
          backwards ? [...current, held] : current.slice(0, -1),
        );
      } catch {
        // Refused: the screen goes back, and the mark stays where it was so the
        // next press is a retry rather than a redo of what did not happen.
        if (off) draw(held.stroke);
        else rub(held.strokeId);
      } finally {
        setStepping(false);
      }
    },
    [done, draw, fits, phase, plan, rub, squadId, stepping, undone],
  );

  const skin = overlaySkin(mode);

  return (
    <div className={cn("flex h-screen flex-col overflow-hidden", skin)}>
      <header
        data-tauri-drag-region
        className="flex h-10 shrink-0 items-center gap-1.5 px-2"
      >
        <span className="min-w-0 truncate text-[13px] font-semibold text-nexus-soft">
          {plan?.name ?? "Plan de vol"}
        </span>

        {phase ? (
          <span className="shrink-0 rounded bg-amber-300/15 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-amber-300">
            {formatClock(phaseStartSec(ordered, phase.id))}
          </span>
        ) : null}

        <span className="flex-1" />

        {plan ? (
          <button
            type="button"
            title="Ouvrir sur le site"
            onClick={() =>
              void getApiBaseUrl().then((base) =>
                openUrl(`${base}/squads/plans/${plan.id}`),
              )
            }
            className="flex size-7 items-center justify-center rounded text-nexus-accent/65 hover:text-nexus-soft"
          >
            <ExternalLink className="size-3.5" />
          </button>
        ) : null}

        <OverlayOpacityButton label="plan" mode={mode} />
        <OverlayLockButton label="plan" locked={locked} />

        <button
          type="button"
          title="Fermer"
          onClick={() => void invoke("close_plan_overlay")}
          className="flex size-7 items-center justify-center rounded text-nexus-accent/65 hover:text-nexus-soft"
        >
          <X className="size-3.5" />
        </button>
      </header>

      {loading || !plan || !phase ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-[13px] text-nexus-accent/65">
          {loading
            ? "…"
            : plans.length === 0
              ? "Aucun plan de vol pour cette escouade."
              : "Ce plan n'a pas encore de phase."}
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 px-2 pb-1.5">
            <button
              type="button"
              title="Phase précédente"
              onClick={() => step(-1)}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-nexus-accent/25 text-nexus-accent/75 hover:text-nexus-soft"
            >
              <ChevronLeft className="size-4" />
            </button>

            <div className="min-w-0 flex-1 text-center">
              <p className="truncate text-[13px] font-semibold text-nexus-soft">
                {ordered.findIndex((one) => one.id === phase.id) + 1} ·{" "}
                {phase.name}
              </p>
              <div className="mt-1 flex justify-center gap-1">
                {ordered.map((one) => (
                  <span
                    key={one.id}
                    className={cn(
                      "h-[3px] w-6 rounded-full",
                      one.id === phase.id
                        ? "bg-nexus-soft"
                        : "bg-nexus-accent/30",
                    )}
                  />
                ))}
              </div>
            </div>

            <button
              type="button"
              title="Phase suivante"
              onClick={() => step(1)}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-nexus-accent/25 text-nexus-accent/75 hover:text-nexus-soft"
            >
              <ChevronRight className="size-4" />
            </button>

            {governs && !locked ? (
              <button
                type="button"
                title="Actions de la phase"
                aria-pressed={acting}
                onClick={() => {
                  setActing(!acting);
                  setRefused(null);
                }}
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg border border-nexus-accent/25",
                  acting
                    ? "bg-nexus-accent/20 text-nexus-soft"
                    : "text-nexus-accent/75 hover:text-nexus-soft",
                )}
              >
                <span className="sr-only">Actions de la phase</span>
                <MoreHorizontal className="size-4" />
              </button>
            ) : null}
          </div>

          {/*
            Deux gestes qu'on ne reprend pas. Ils vivent ici plutôt que dans la
            barre d'outils : le stylo disparaît sur une phase figée, alors que
            supprimer une phase figée reste permis — geler protège un dessin,
            pas l'existence de la phase. C'est la règle du serveur, suivie et
            non réinventée.
          */}
          {acting && governs && !locked ? (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-2 pb-1.5">
              <PhaseAction
                icon={<Eraser className="size-3.5" />}
                label="Vider"
                confirmLabel="Effacer tous les traits ?"
                disabled={working || phase.locked}
                reason={phase.locked ? "Phase figée" : undefined}
                onConfirm={() => void actOnPhase("clear")}
              />

              {ordered.length > 1 ? (
                <PhaseAction
                  icon={<Trash2 className="size-3.5" />}
                  label="Supprimer"
                  confirmLabel="Supprimer la phase ?"
                  disabled={working}
                  onConfirm={() => void actOnPhase("remove")}
                />
              ) : (
                <span className="text-[11px] text-nexus-accent/50">
                  Un plan garde au moins une phase.
                </span>
              )}

              {refused ? (
                <span className="w-full text-[11px] text-red-300">
                  {refused}
                </span>
              ) : null}
            </div>
          ) : null}

          <PlanCanvas
            strokes={layer.strokes}
            background={
              plan.backgroundUrl
                ? {
                    url: plan.backgroundUrl,
                    width: plan.backgroundW,
                    height: plan.backgroundH,
                  }
                : null
            }
            mySquadId={mySquadId ?? ""}
            squad={state.squad ?? null}
            raid={state.raid ?? null}
            drawing={drawable && tool === "pen"}
            erasing={drawable && tool === "eraser"}
            onDraw={onDraw}
            onErase={onErase}
            className="min-h-0 flex-1"
          />

          {mine ? (
            <div className="shrink-0 border-t border-nexus-accent/15 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wider text-nexus-accent/55">
                Vous
              </p>
              <p className="text-[13px] font-semibold text-nexus-soft">
                {mine.task}
              </p>
            </div>
          ) : phase.objective ? (
            <div className="shrink-0 border-t border-nexus-accent/15 px-2.5 py-2">
              <p className="line-clamp-3 text-[12px] leading-snug text-nexus-accent/85">
                {phase.objective}
              </p>
            </div>
          ) : null}

          <footer className="flex h-10 shrink-0 items-center gap-1.5 border-t border-nexus-accent/15 px-2">
            {presenter ? (
              <span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] text-amber-300">
                <span className="size-1.5 shrink-0 rounded-full bg-amber-300" />
                {stepped && stepped !== presenter.phaseId
                  ? `${presenter.name} mène`
                  : `Suit ${presenter.name}`}
              </span>
            ) : null}

            {presenter && stepped && stepped !== presenter.phaseId ? (
              <button
                type="button"
                onClick={() => setStepped(null)}
                className="shrink-0 rounded border border-nexus-accent/25 px-1.5 py-0.5 text-[11px] text-nexus-accent/85 hover:text-nexus-soft"
              >
                Suivre
              </button>
            ) : null}

            <span className="flex-1" />

            {phase.locked ? (
              <span
                title="Phase figée"
                className="flex items-center gap-1 text-[11px] text-amber-300"
              >
                <Lock className="size-3.5" />
                Figée
              </span>
            ) : locked ? (
              <span className="text-[11px] text-nexus-accent/50">
                Déverrouillez pour dessiner
              </span>
            ) : (
              <>
                <button
                  type="button"
                  title="Annuler"
                  disabled={!canUndo}
                  onClick={() => void walk(true)}
                  className={cn(
                    "flex size-7 items-center justify-center rounded text-nexus-accent/65 hover:text-nexus-soft",
                    !canUndo && "cursor-default opacity-30 hover:text-nexus-accent/65",
                  )}
                >
                  <Undo2 className="size-3.5" />
                </button>

                <button
                  type="button"
                  title="Rétablir"
                  disabled={!canRedo}
                  onClick={() => void walk(false)}
                  className={cn(
                    "flex size-7 items-center justify-center rounded text-nexus-accent/65 hover:text-nexus-soft",
                    !canRedo && "cursor-default opacity-30 hover:text-nexus-accent/65",
                  )}
                >
                  <Redo2 className="size-3.5" />
                </button>

                <button
                  type="button"
                  title="Trait libre"
                  aria-pressed={tool === "pen"}
                  onClick={() => setTool(tool === "pen" ? "none" : "pen")}
                  className={cn(
                    "flex size-7 items-center justify-center rounded",
                    tool === "pen"
                      ? "bg-nexus-accent/25 text-nexus-soft"
                      : "text-nexus-accent/65 hover:text-nexus-soft",
                  )}
                >
                  <Pencil className="size-3.5" />
                </button>

                <button
                  type="button"
                  title="Gomme — vos traits, et ceux des autres si vous menez le plan"
                  aria-pressed={tool === "eraser"}
                  onClick={() => setTool(tool === "eraser" ? "none" : "eraser")}
                  className={cn(
                    "flex size-7 items-center justify-center rounded",
                    tool === "eraser"
                      ? "bg-nexus-accent/25 text-nexus-soft"
                      : "text-nexus-accent/65 hover:text-nexus-soft",
                  )}
                >
                  <Eraser className="size-3.5" />
                </button>
              </>
            )}
          </footer>
        </>
      )}
    </div>
  );
}

/**
 * Un bouton qui demande deux fois.
 *
 * Même idiome que la clôture d'une feuille de cargo : le bouton devient sa
 * propre confirmation, sur place. Pas de fenêtre modale — au-dessus d'un jeu,
 * une boîte qui prend le clavier est pire que le geste qu'elle protège — et
 * pas de second clic au même endroit non plus : le libellé change, donc la
 * cible aussi.
 *
 * Armé, il le reste jusqu'au clic ou à l'annulation. Le désarmer à la perte du
 * focus serait tentant, mais cette fenêtre vit au-dessus d'un jeu : elle perd
 * le focus sans arrêt, et la confirmation se refermerait toute seule avant
 * qu'on ait pu la viser.
 */
function PhaseAction({
  icon,
  label,
  confirmLabel,
  disabled,
  reason,
  onConfirm,
}: {
  icon: React.ReactNode;
  label: string;
  confirmLabel: string;
  disabled?: boolean;
  /** Pourquoi c'est indisponible, quand ça l'est. */
  reason?: string;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);

  if (disabled) {
    return (
      <span
        title={reason}
        className="flex cursor-default items-center gap-1.5 rounded border border-nexus-accent/15 px-2 py-1 text-[11px] text-nexus-accent/40"
      >
        {icon}
        {reason ?? label}
      </span>
    );
  }

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="flex items-center gap-1.5 rounded border border-nexus-accent/25 px-2 py-1 text-[11px] text-nexus-accent/85 transition-colors hover:border-red-400/50 hover:text-red-300"
      >
        {icon}
        {label}
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={onConfirm}
        className="flex items-center gap-1.5 rounded border border-red-400/50 bg-red-500/15 px-2 py-1 text-[11px] font-medium text-red-200"
      >
        {icon}
        {confirmLabel}
      </button>
      <button
        type="button"
        title="Annuler"
        onClick={() => setAsking(false)}
        className="rounded p-1 text-nexus-accent/65 hover:text-nexus-soft"
      >
        <span className="sr-only">Annuler</span>
        <X className="size-3" />
      </button>
    </span>
  );
}
