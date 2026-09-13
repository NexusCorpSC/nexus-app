import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  ExternalLink,
  Lock,
  Pencil,
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
import { commitStroke, eraseStroke } from "@/lib/api/plans";
import { overlaySkin } from "@/lib/overlay-opacity";
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
 */
export default function PlanOverlayPage() {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;

  useTransparentWindow();

  const mode = useOverlayMode("plan");
  const locked = useOverlayLocked("plan");

  const { state } = useSquad(true, null, userId);
  const squadId = state.squad?.id ?? null;

  /** What the reader chose; everything else is the briefing's own. */
  const [stepped, setStepped] = useState<string | null>(null);
  const [tool, setTool] = useState<"none" | "pen" | "eraser">("none");

  const { plans, plan, ordered, phase, layer, draw, rub } = usePlan(squadId, {
    phaseId: stepped,
  });

  const presenter = plan?.presenter ?? null;
  const mine =
    phase && userId
      ? (phase.assignments.find((one) => one.userId === userId) ?? null)
      : null;

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
      if (!plan || !phase || !squadId) return;

      const stored = forStorage(points);
      const clientId = crypto.randomUUID().replace(/-/g, "");

      // On screen before the round trip. The delta brings the stored stroke
      // back under its own id, and the optimistic one is rubbed out with it.
      const optimistic: PlanStroke = {
        id: `local-${clientId}`,
        phaseId: phase.id,
        epoch: phase.epoch,
        rev: Number.MAX_SAFE_INTEGER,
        clientId,
        authorId: userId ?? "",
        authorName: user?.name ?? "",
        squadId,
        kind: "pen",
        ink: "squad",
        width: 6,
        points: stored,
        text: "",
        tokenUserId: "",
        deletedAt: null,
        createdAt: new Date().toISOString(),
      };

      draw(optimistic);

      try {
        await commitStroke(plan.id, phase.id, squadId, {
          clientId,
          kind: "pen",
          ink: "squad",
          width: 6,
          points: stored,
        });
      } catch {
        rub(optimistic.id);
      }
    },
    [draw, phase, plan, rub, squadId, user?.name, userId],
  );

  const onErase = useCallback(
    async (strokeId: string) => {
      if (!plan || !phase || !squadId) return;

      const held = layer.strokes.find((stroke) => stroke.id === strokeId);
      rub(strokeId);

      if (!held || strokeId.startsWith("local-")) return;

      try {
        await eraseStroke(plan.id, phase.id, strokeId, squadId);
      } catch {
        draw(held);
      }
    },
    [draw, layer.strokes, phase, plan, rub, squadId],
  );

  const skin = overlaySkin(mode);
  const drawable = !locked && phase !== null && !phase.locked;

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
          </div>

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
            mySquadId={squadId ?? ""}
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
                  title="Gomme — vos traits seulement"
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
