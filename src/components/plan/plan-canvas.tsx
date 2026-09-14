import { memo, useCallback, useMemo, useRef } from "react";

import { fitBackground, pathOf } from "@/lib/plan-geometry";
import { cn } from "@/lib/utils";
import {
  DASHED_KINDS,
  PLAN_GRID,
  type PlanInk,
  type PlanStroke,
  type Raid,
  type Squad,
  type StrokeDash,
} from "@/types/nexus";

/**
 * The drawing, over the game.
 *
 * The whole phase at once — no panning, no zoom. A 560-pixel window over a
 * cockpit is read at a glance or not at all, and a plan that had to be
 * navigated would be one more thing to do while flying. The site is where a
 * plan is worked on.
 *
 * The trace under the pen is written straight onto one `<path>` node, as on the
 * site: a render per pointer event is frames dropped, and nothing else on
 * screen needs to know. Committed strokes never change, so each is memoised by
 * id.
 *
 * The plan's square is **drawn**, and the pointer is held inside it: the window
 * is not square, so the margins belong to no plan, and a trace put there used
 * to be folded onto the edge behind the drawer's back.
 */

/** Grid units per unit of stored width. Mirrors the site's own scale. */
const WIDTH_SCALE = 8;
const TEXT_SIZE = 190;

/** What the eraser catches beyond a trace's own ink. Mirrors the site. */
const HIT_PAD = 110;

/**
 * A hue per sub-squad, the same list and order as `use-raid-layout` draws the
 * raid in — and as the site's `app/squads/plans/ink.ts`. Blues through pinks:
 * green, amber and red already mean ready, leader and down.
 */
const SQUAD_HUES = [250, 300, 340, 200, 275, 320];

const INKS: Record<Exclude<PlanInk, "squad">, string> = {
  amber: "#FCD34D",
  red: "#FCA5A5",
  green: "#6EE7B7",
  sky: "#7DD3FC",
  violet: "oklch(0.74 0.13 300)",
  white: "#CCE7FF",
};

/** Mirrors `dashFor` in the site's `app/squads/plans/canvas.tsx`. */
function dashFor(dash: StrokeDash, thickness: number): string | undefined {
  if (dash === "dashed") return `${thickness * 2} ${thickness * 3}`;
  if (dash === "dotted") return `0 ${thickness * 2}`;

  return undefined;
}

export function PlanCanvas({
  strokes,
  background,
  mySquadId,
  squad,
  raid,
  drawing,
  erasing,
  onDraw,
  onErase,
  className,
}: {
  strokes: PlanStroke[];
  background: { url: string; width: number; height: number } | null;
  mySquadId: string;
  squad: Squad | null;
  raid: Raid | null;
  drawing: boolean;
  erasing: boolean;
  onDraw: (points: number[]) => void;
  onErase: (strokeId: string) => void;
  className?: string;
}) {
  const svg = useRef<SVGSVGElement | null>(null);
  const live = useRef<SVGPathElement | null>(null);
  const points = useRef<number[]>([]);
  const tracing = useRef(false);

  /**
   * The eraser, held down.
   *
   * **Nothing captures the pointer while this is true.** A captured pointer
   * sends every event to whoever captured it, so the traces being swept over
   * would never see `pointerenter` and the gomme would be back to one trace
   * per click.
   */
  const rubbing = useRef(false);

  const hues = useMemo(() => {
    const map = new Map<string, string>();

    if (raid) {
      raid.squads.forEach((sub, index) =>
        map.set(sub.id, `oklch(0.74 0.13 ${SQUAD_HUES[index % SQUAD_HUES.length]})`),
      );
    } else if (squad) {
      map.set(squad.id, `oklch(0.74 0.13 ${SQUAD_HUES[0]})`);
    }

    return map;
  }, [raid, squad]);

  /** A client point, on the sheet — never outside it. */
  const at = useCallback((event: React.PointerEvent): [number, number] => {
    const node = svg.current;
    const matrix = node?.getScreenCTM();
    if (!matrix) return [0, 0];

    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );

    return [
      Math.max(0, Math.min(PLAN_GRID, point.x)),
      Math.max(0, Math.min(PLAN_GRID, point.y)),
    ];
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.button !== 0) return;

      if (erasing) {
        // No capture: see `rubbing`.
        rubbing.current = true;
        return;
      }

      if (!drawing) return;

      tracing.current = true;
      points.current = at(event);
      event.currentTarget.setPointerCapture(event.pointerId);
      live.current?.setAttribute("d", pathOf(points.current));
    },
    [at, drawing, erasing],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!tracing.current) return;

      const [x, y] = at(event);
      points.current.push(x, y);
      live.current?.setAttribute("d", pathOf(points.current));
    },
    [at],
  );

  const onPointerUp = useCallback(() => {
    rubbing.current = false;

    if (!tracing.current) return;
    tracing.current = false;

    const trace = points.current;
    points.current = [];
    live.current?.setAttribute("d", "");

    if (trace.length >= 4) onDraw(trace);
  }, [onDraw]);

  /** Whether the eraser is down, read by every trace without re-rendering one. */
  const held = useCallback(() => rubbing.current, []);

  const fitted = background ? fitBackground(background) : null;
  const mine = hues.get(mySquadId) ?? `oklch(0.74 0.13 ${SQUAD_HUES[0]})`;

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <svg
        ref={svg}
        viewBox={`0 0 ${PLAN_GRID} ${PLAN_GRID}`}
        className="absolute inset-0 size-full touch-none"
        style={{ cursor: drawing ? "crosshair" : erasing ? "pointer" : "default" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          rubbing.current = false;
        }}
      >
        {fitted ? (
          <image
            href={background!.url}
            x={fitted.x}
            y={fitted.y}
            width={fitted.width}
            height={fitted.height}
            preserveAspectRatio="none"
          />
        ) : null}

        {strokes.map((stroke) => (
          <Trace
            key={stroke.id}
            stroke={stroke}
            hues={hues}
            held={held}
            onErase={erasing ? onErase : undefined}
          />
        ))}

        <path
          ref={live}
          fill="none"
          stroke={mine}
          strokeWidth={6 * WIDTH_SCALE}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />

        {/* Where the plan stops. The window is not square and the sheet is. */}
        <g pointerEvents="none" fill="#061E30" opacity={0.55}>
          <rect x={-2 * PLAN_GRID} y={-2 * PLAN_GRID} width={5 * PLAN_GRID} height={2 * PLAN_GRID} />
          <rect x={-2 * PLAN_GRID} y={PLAN_GRID} width={5 * PLAN_GRID} height={2 * PLAN_GRID} />
          <rect x={-2 * PLAN_GRID} y={0} width={2 * PLAN_GRID} height={PLAN_GRID} />
          <rect x={PLAN_GRID} y={0} width={2 * PLAN_GRID} height={PLAN_GRID} />
        </g>

        <rect
          width={PLAN_GRID}
          height={PLAN_GRID}
          fill="none"
          stroke="#9ED0FF"
          strokeOpacity={0.25}
          strokeWidth={16}
          pointerEvents="none"
        />
      </svg>
    </div>
  );
}

const Trace = memo(function Trace({
  stroke,
  hues,
  held,
  onErase,
}: {
  stroke: PlanStroke;
  hues: Map<string, string>;
  held?: () => boolean;
  onErase?: (strokeId: string) => void;
}) {
  const color =
    stroke.ink === "squad"
      ? (hues.get(stroke.squadId) ?? `oklch(0.74 0.13 ${SQUAD_HUES[0]})`)
      : INKS[stroke.ink];

  const thickness = stroke.width * WIDTH_SCALE;
  const [x0, y0, x1, y1] = stroke.points;

  const erase = onErase
    ? {
        onPointerDown: (event: React.PointerEvent) => {
          // The primary button only, as the pen is: a right-click is a menu
          // somebody asked for, not a trace they meant to lose.
          if (event.button !== 0) return;

          // **The event is let through on purpose.** It is what puts the
          // canvas into rubbing mode, and stopping it here would mean a sweep
          // that *started* on a trace rubbed that one out and then nothing
          // else. The `<svg>` only ever arms the gomme while it is out, so
          // there is nothing underneath worth shielding it from.
          onErase(stroke.id);
        },
        // The gomme rubs where it is dragged, not only where it is clicked.
        onPointerEnter: () => {
          if (!held?.()) return;

          onErase(stroke.id);
        },
        style: { cursor: "pointer" as const },
      }
    : {};

  const line = {
    fill: "none",
    stroke: color,
    strokeWidth: thickness,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeDasharray: DASHED_KINDS.includes(stroke.kind)
      ? dashFor(stroke.dash, thickness)
      : undefined,
  };

  /** The same shape, wide and invisible, so a two-pixel line can be swept over. */
  const grip = onErase
    ? {
        fill: "none",
        stroke: "transparent",
        strokeWidth: thickness + HIT_PAD,
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
        pointerEvents: "stroke" as const,
      }
    : null;

  if (stroke.kind === "pen") {
    const d = pathOf(stroke.points);

    return (
      <g {...erase}>
        <path d={d} {...line} />
        {grip ? <path d={d} {...grip} /> : null}
      </g>
    );
  }

  if (stroke.kind === "line" || stroke.kind === "arrow") {
    const straight = `M ${x0} ${y0} L ${x1} ${y1}`;
    const drawn =
      stroke.kind === "arrow"
        ? arrowPath(x0, y0, x1, y1, thickness)
        : { shaft: straight, head: "" };

    return (
      <g {...erase}>
        <path
          d={drawn.shaft}
          {...line}
          strokeLinecap={stroke.kind === "arrow" ? "butt" : "round"}
        />
        {drawn.head ? <path d={drawn.head} fill={color} stroke="none" /> : null}
        {grip ? <path d={straight} {...grip} /> : null}
      </g>
    );
  }

  if (stroke.kind === "rect" || stroke.kind === "ellipse") {
    const d =
      stroke.kind === "rect"
        ? rectPath(
            Math.min(x0, x1),
            Math.min(y0, y1),
            Math.abs(x1 - x0),
            Math.abs(y1 - y0),
          )
        : ellipsePath(x0, y0, x1, y1);

    return (
      <g {...erase}>
        <path d={d} {...line} />
        {grip ? <path d={d} {...grip} /> : null}
      </g>
    );
  }

  if (stroke.kind === "text") {
    return (
      <text
        x={x0}
        y={y0}
        fill={color}
        fontSize={TEXT_SIZE}
        fontWeight={600}
        fontFamily="sans-serif"
        {...(grip
          ? {
              stroke: "transparent",
              strokeWidth: HIT_PAD,
              paintOrder: "stroke" as const,
            }
          : {})}
        {...erase}
      >
        {stroke.text}
      </text>
    );
  }

  const radius = TEXT_SIZE * 0.9;

  return (
    <g {...erase}>
      {grip ? (
        <circle cx={x0} cy={y0} r={radius + HIT_PAD / 2} fill="transparent" />
      ) : null}
      <circle
        cx={x0}
        cy={y0}
        r={radius}
        fill="#061E30"
        stroke={color}
        strokeWidth={thickness}
      />
      <text
        x={x0}
        y={y0 + TEXT_SIZE * 0.3}
        fill={color}
        fontSize={TEXT_SIZE * 0.8}
        fontWeight={700}
        fontFamily="sans-serif"
        textAnchor="middle"
      >
        {(stroke.text || stroke.authorName).slice(0, 2).toUpperCase()}
      </text>
      {stroke.text ? (
        <text
          x={x0}
          y={y0 + radius + TEXT_SIZE}
          fill="#CCE7FF"
          fontSize={TEXT_SIZE * 0.85}
          fontWeight={600}
          fontFamily="sans-serif"
          textAnchor="middle"
        >
          {stroke.text}
        </text>
      ) : null}
    </g>
  );
});

function rectPath(x: number, y: number, width: number, height: number): string {
  return `M ${x} ${y} h ${width} v ${height} h ${-width} Z`;
}

function ellipsePath(x0: number, y0: number, x1: number, y1: number): string {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.abs(x1 - x0) / 2;
  const ry = Math.abs(y1 - y0) / 2;

  return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0`;
}

/**
 * An arrow, as a shaft and a notched head. Mirrors the site's `arrowPath`: a
 * flat triangle three thicknesses long was ten pixels of point on a line meant
 * to be read across a cockpit.
 */
function arrowPath(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thickness: number,
): { shaft: string; head: string } {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);

  if (length < 1) return { shaft: "", head: "" };

  const ux = dx / length;
  const uy = dy / length;

  const size = Math.min(
    Math.max(thickness * 4, 150),
    Math.max(length / 3, thickness),
  );

  const px = -uy;
  const py = ux;
  const half = size * 0.46;

  const bx = x1 - ux * size;
  const by = y1 - uy * size;
  const nx = x1 - ux * size * 0.72;
  const ny = y1 - uy * size * 0.72;

  const at = (x: number, y: number) => `${x.toFixed(1)} ${y.toFixed(1)}`;

  return {
    shaft: `M ${at(x0, y0)} L ${at(nx, ny)}`,
    head: `M ${at(x1, y1)} L ${at(bx + px * half, by + py * half)} L ${at(nx, ny)} L ${at(bx - px * half, by - py * half)} Z`,
  };
}
