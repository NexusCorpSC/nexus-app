import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  Check,
  HeartPulse,
  Lock,
  LockOpen,
  ScanText,
  Skull,
  X,
} from "lucide-react";
import { useTransparentWindow } from "@/hooks/use-transparent-window";
import { formatShortcut } from "@/lib/settings";
import {
  RADIAL_CANCEL_EVENT,
  RADIAL_OPEN_EVENT,
  RADIAL_POINTER_EVENT,
  RADIAL_RELEASE_EVENT,
  RADIAL_SQUAD_ACTION_EVENT,
  RADIAL_SQUAD_EVENT,
  RADIAL_SQUAD_REQUEST_EVENT,
  SECTOR_ANGLES,
  SECTOR_HALF_WIDTH,
  SQUAD_WINDOW,
  sectorAt,
  type RadialOpened,
  type RadialPointer,
  type RadialSector,
  type RadialSquad,
  type RadialSquadAction,
} from "@/lib/radial";
import { cn } from "@/lib/utils";

/** The ring, in the SVG's own units: 400 across, the hub in the middle. */
const SIZE = 400;
const CENTRE = SIZE / 2;
const OUTER = 180;
const INNER = 78;
const HUB = 70;
/** Between two sectors, in degrees on each side. */
const GAP = 2;

const CENTRED: RadialPointer = { x: 0, y: 0 };

function polar(angle: number, radius: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: CENTRE + radius * Math.sin(radians),
    y: CENTRE - radius * Math.cos(radians),
  };
}

/** One sector of the ring, as an SVG path, from its middle angle. */
function wedge(middle: number): string {
  const from = middle - SECTOR_HALF_WIDTH + GAP;
  const to = middle + SECTOR_HALF_WIDTH - GAP;
  const a = polar(from, OUTER);
  const b = polar(to, OUTER);
  const c = polar(to, INNER);
  const d = polar(from, INNER);

  return [
    `M${a.x} ${a.y}`,
    `A${OUTER} ${OUTER} 0 0 1 ${b.x} ${b.y}`,
    `L${c.x} ${c.y}`,
    `A${INNER} ${INNER} 0 0 0 ${d.x} ${d.y}`,
    "Z",
  ].join(" ");
}

/** Where a sector's label is centred, in pixels from the ring's corner. */
function labelAt(sector: RadialSector) {
  return polar(SECTOR_ANGLES[sector], (OUTER + INNER) / 2);
}

/**
 * The quick radial menu, over the game while its shortcut is held.
 *
 * Rust shows it, moves its pointer and hides it (`src-tauri/src/radial.rs`);
 * this draws it and acts on the sector the pointer was in when the keys were
 * let go. Squad actions go to the squad window, which has the session — see
 * `useRadialBridge` — and lock and capture to the commands their shortcuts
 * run. The menu is its own window and never locked, so it stays usable over
 * locked overlays — including to unlock them.
 */
export default function RadialOverlayPage() {
  const [squad, setSquad] = useState<RadialSquad | null>(null);
  const [pointer, setPointer] = useState<RadialPointer>(CENTRED);
  const [accelerator, setAccelerator] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  // Bumped on every opening, so the entrance plays again.
  const [opening, setOpening] = useState(0);

  const squadRef = useRef(squad);
  useEffect(() => {
    squadRef.current = squad;
  }, [squad]);

  useTransparentWindow();

  useEffect(() => {
    const stops: UnlistenFn[] = [];
    let gone = false;

    const keep = (stop: UnlistenFn) => {
      if (gone) stop();
      else stops.push(stop);
    };

    const follow = <T,>(event: string, handler: (payload: T) => void) =>
      void listen<T>(event, (received) => handler(received.payload))
        .then(keep)
        .catch((error) => {
          console.error(`cannot follow ${event}`, error);
        });

    follow<RadialSquad | null>(RADIAL_SQUAD_EVENT, setSquad);

    follow<RadialOpened>(RADIAL_OPEN_EVENT, (opened) => {
      setPointer(CENTRED);
      setAccelerator(opened?.accelerator ?? null);
      setLocked(Boolean(opened?.locked));
      setOpening((count) => count + 1);
    });

    follow<RadialPointer>(RADIAL_POINTER_EVENT, setPointer);

    follow<RadialPointer>(RADIAL_RELEASE_EVENT, (released) => {
      setPointer(CENTRED);
      act(released, squadRef.current);
    });

    follow<null>(RADIAL_CANCEL_EVENT, () => setPointer(CENTRED));

    // Created hidden at startup, possibly after the squad window told the
    // squad to nobody: ask for it.
    void emitTo(SQUAD_WINDOW, RADIAL_SQUAD_REQUEST_EVENT).catch((error) => {
      console.error("cannot ask for the squad", error);
    });

    return () => {
      gone = true;
      stops.forEach((stop) => stop());
    };
  }, []);

  const offered = offeredSectors(squad);
  const hovered = sectorAt(pointer, offered);
  const down = squad ? !squad.alive : false;

  // Drawn inside the hub: the pointer says which way, the sector lights up.
  const length = Math.hypot(pointer.x, pointer.y);
  const scale = (HUB - 8) / Math.max(1, length);
  const tip = {
    x: CENTRE + pointer.x * scale,
    y: CENTRE + pointer.y * scale,
  };

  const hub = hubText(hovered, squad, locked);

  return (
    <div
      key={opening}
      className="nexus-radial flex h-screen w-screen select-none flex-col items-center justify-between py-1 text-nexus-bright"
    >
      <div className="h-7">
        {squad ? (
          <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-nexus-accent/20 bg-nexus-abyss/90 px-3 py-1 text-xs">
            <span className="max-w-48 truncate font-semibold">
              {squad.squadName}
            </span>
            <span className="text-nexus-accent/50">·</span>
            <span className="text-emerald-300">
              {squad.readyCount}/{squad.total} prêts
            </span>
          </div>
        ) : null}
      </div>

      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="absolute inset-0"
        >
          {offered.map((sector) => {
            const disabled = sector === "ready" && down;
            const hot = hovered === sector && !disabled;

            return (
              <path
                key={sector}
                d={wedge(SECTOR_ANGLES[sector])}
                strokeWidth={1.5}
                className={cn(
                  "transition-colors duration-75",
                  disabled
                    ? "fill-nexus-panel/45 stroke-nexus-accent/15"
                    : hot
                      ? "fill-nexus-accent/25 stroke-nexus-accent"
                      : "fill-nexus-panel/85 stroke-nexus-accent/20",
                )}
              />
            );
          })}

          <circle
            cx={CENTRE}
            cy={CENTRE}
            r={HUB}
            strokeWidth={1}
            className="fill-nexus-abyss/95 stroke-nexus-accent/25"
          />

          {length >= 0.05 ? (
            <>
              <line
                x1={CENTRE}
                y1={CENTRE}
                x2={tip.x}
                y2={tip.y}
                strokeWidth={2}
                strokeLinecap="round"
                className="stroke-nexus-accent"
              />
              <circle
                cx={tip.x}
                cy={tip.y}
                r={4}
                className="fill-nexus-accent"
              />
            </>
          ) : null}
        </svg>

        {squad ? (
          <>
            <SectorLabel sector="ready" dimmed={down}>
              {squad.ready ? (
                <X className="size-6 text-red-300" strokeWidth={2.2} />
              ) : (
                <Check className="size-6 text-emerald-300" strokeWidth={2.4} />
              )}
              <span
                className={cn(
                  "text-[13px] font-bold tracking-wider",
                  squad.ready ? "text-red-300" : "text-emerald-300",
                )}
              >
                {squad.ready ? "NOT READY" : "READY"}
              </span>
              <span className="text-[11px] text-nexus-accent/60">
                {down
                  ? "Indisponible : éliminé"
                  : squad.ready
                    ? "Tu es : prêt"
                    : "Tu es : pas prêt"}
              </span>
            </SectorLabel>

            <SectorLabel sector="alive">
              {down ? (
                <HeartPulse className="size-6 text-emerald-300" />
              ) : (
                <Skull className="size-6 text-red-300" />
              )}
              <span
                className={cn(
                  "text-[13px] font-bold tracking-wider",
                  down ? "text-emerald-300" : "text-red-300",
                )}
              >
                {down ? "ACTIF" : "ÉLIMINÉ"}
              </span>
              <span className="text-[11px] text-nexus-accent/60">
                {down ? "Tu es : éliminé" : "Tu es : actif"}
              </span>
            </SectorLabel>
          </>
        ) : null}

        <SectorLabel sector="lock">
          {locked ? (
            <LockOpen className="size-6 text-amber-200" />
          ) : (
            <Lock className="size-6 text-amber-200" />
          )}
          <span className="text-[13px] font-bold tracking-wider text-amber-200">
            {locked ? "DÉVERROUILLER" : "VERROUILLER"}
          </span>
          <span className="text-[11px] text-nexus-accent/60">
            {locked ? "Superpositions verrouillées" : "Superpositions"}
          </span>
        </SectorLabel>

        <SectorLabel sector="capture">
          <ScanText className="size-6 text-nexus-accent" />
          <span className="text-[13px] font-bold tracking-wider">CAPTURE</span>
          <span className="text-[11px] text-nexus-accent/60">
            Capture de zone
          </span>
        </SectorLabel>

        <div
          className="absolute flex flex-col items-center justify-center gap-1 text-center"
          style={{
            left: CENTRE - 60,
            top: CENTRE - 50,
            width: 120,
            height: 100,
          }}
        >
          <span className="text-xs font-semibold leading-tight">
            {hub.title}
          </span>
          <span className="text-[10px] leading-snug text-nexus-accent/55">
            {hub.detail}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-nexus-accent/15 bg-nexus-abyss/85 px-3 py-1.5 text-xs text-nexus-accent/75">
        {accelerator
          ? formatShortcut(accelerator)
              .split(" + ")
              .map((key, index) => (
                <span key={key} className="flex items-center gap-2">
                  {index > 0 ? (
                    <span className="text-nexus-accent/50">+</span>
                  ) : null}
                  <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-nexus-accent px-1.5 font-mono text-[11px] font-bold text-nexus-abyss shadow-[0_2px_0_#4f86b8]">
                    {key}
                  </kbd>
                </span>
              ))
          : null}
        <span>relâcher pour valider</span>
        <span className="text-nexus-accent/35">·</span>
        <span>au centre ou Échap pour annuler</span>
      </div>
    </div>
  );
}

function SectorLabel({
  sector,
  dimmed = false,
  children,
}: {
  sector: RadialSector;
  dimmed?: boolean;
  children: React.ReactNode;
}) {
  const { x, y } = labelAt(sector);

  return (
    <div
      className={cn(
        "absolute flex flex-col items-center gap-1 text-center",
        dimmed && "opacity-40",
      )}
      style={{ left: x - 60, top: y - 34, width: 120 }}
    >
      {children}
    </div>
  );
}

/**
 * The sectors on offer. Squad actions only for someone with a row in a squad;
 * lock and capture always.
 */
function offeredSectors(squad: RadialSquad | null): RadialSector[] {
  return squad ? ["ready", "alive", "lock", "capture"] : ["lock", "capture"];
}

function hubText(
  hovered: RadialSector | null,
  squad: RadialSquad | null,
  locked: boolean,
): { title: string; detail: string } {
  const down = squad ? !squad.alive : false;

  switch (hovered) {
    case "ready":
      if (down) {
        return { title: "Indisponible", detail: "Repasse Actif d'abord" };
      }
      return {
        title: squad?.ready ? "Passer NOT READY" : "Passer READY",
        detail: "Relâche pour valider",
      };
    case "alive":
      return down
        ? { title: "Revenir actif", detail: "Relâche pour valider" }
        : { title: "Me déclarer éliminé", detail: "Retire aussi READY" };
    case "lock":
      return locked
        ? {
            title: "Déverrouiller",
            detail: "Les fenêtres reprennent les clics",
          }
        : { title: "Verrouiller", detail: "Les clics passent au jeu" };
    case "capture":
      return { title: "Capture de zone", detail: "Relâche pour lancer" };
    default:
      return { title: "Aucune action", detail: "Relâcher ici annule" };
  }
}

/** Does what the sector under the released pointer stands for. */
function act(released: RadialPointer, squad: RadialSquad | null) {
  const sector = sectorAt(released, offeredSectors(squad));

  if (sector === "lock") {
    void invoke("radial_toggle_lock").catch((error) => {
      console.error("cannot toggle the overlay locks from the menu", error);
    });
    return;
  }

  if (sector === "capture") {
    void invoke("radial_capture").catch((error) => {
      console.error("cannot start a capture from the radial menu", error);
    });
    return;
  }

  if ((sector === "ready" || sector === "alive") && squad) {
    // Refused here as well as in the squad window: drawn disabled, it must
    // not do anything either.
    if (sector === "ready" && !squad.alive) return;

    void emitTo(SQUAD_WINDOW, RADIAL_SQUAD_ACTION_EVENT, {
      action: sector,
      squadId: squad.squadId,
    } satisfies RadialSquadAction).catch((error) => {
      console.error("cannot hand the squad action over", error);
    });
  }
}
