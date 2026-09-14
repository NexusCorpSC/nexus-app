import { memo, useCallback, useMemo, useRef } from "react";

import { fitBackground, pathOf } from "@/lib/plan-geometry";
import { cn } from "@/lib/utils";
import {
  PLAN_GRID,
  type PlanInk,
  type PlanStroke,
  type Raid,
  type Squad,
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
 */

/** Grid units per unit of stored width. Mirrors the site's own scale. */
const WIDTH_SCALE = 8;
const TEXT_SIZE = 190;

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

  const at = useCallback((event: React.PointerEvent): [number, number] => {
    const node = svg.current;
    const matrix = node?.getScreenCTM();
    if (!matrix) return [0, 0];

    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );

    return [point.x, point.y];
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!drawing || event.button !== 0) return;

      tracing.current = true;
      points.current = at(event);
      event.currentTarget.setPointerCapture(event.pointerId);
      live.current?.setAttribute("d", pathOf(points.current));
    },
    [at, drawing],
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
    if (!tracing.current) return;
    tracing.current = false;

    const trace = points.current;
    points.current = [];
    live.current?.setAttribute("d", "");

    if (trace.length >= 4) onDraw(trace);
  }, [onDraw]);

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
      </svg>
    </div>
  );
}

const Trace = memo(function Trace({
  stroke,
  hues,
  onErase,
}: {
  stroke: PlanStroke;
  hues: Map<string, string>;
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

          event.stopPropagation();
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
  };

  if (stroke.kind === "pen") {
    return <path d={pathOf(stroke.points)} {...line} {...erase} />;
  }

  if (stroke.kind === "line" || stroke.kind === "arrow") {
    return (
      <g {...erase}>
        <line x1={x0} y1={y0} x2={x1} y2={y1} {...line} />
        {stroke.kind === "arrow" ? (
          <path d={arrowHead(x0, y0, x1, y1, thickness)} fill={color} stroke="none" />
        ) : null}
      </g>
    );
  }

  if (stroke.kind === "rect") {
    return (
      <rect
        x={Math.min(x0, x1)}
        y={Math.min(y0, y1)}
        width={Math.abs(x1 - x0)}
        height={Math.abs(y1 - y0)}
        {...line}
        {...erase}
      />
    );
  }

  if (stroke.kind === "ellipse") {
    return (
      <ellipse
        cx={(x0 + x1) / 2}
        cy={(y0 + y1) / 2}
        rx={Math.abs(x1 - x0) / 2}
        ry={Math.abs(y1 - y0) / 2}
        {...line}
        {...erase}
      />
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
        {...erase}
      >
        {stroke.text}
      </text>
    );
  }

  const radius = TEXT_SIZE * 0.9;

  return (
    <g {...erase}>
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
      <text
        x={x0}
        y={y0 + radius + TEXT_SIZE}
        fill="#CCE7FF"
        fontSize={TEXT_SIZE * 0.85}
        fontWeight={600}
        fontFamily="sans-serif"
        textAnchor="middle"
      >
        {stroke.text || stroke.authorName}
      </text>
    </g>
  );
});

function arrowHead(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thickness: number,
): string {
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const size = thickness * 3;
  const spread = 0.42;

  const ax = x1 - size * Math.cos(angle - spread);
  const ay = y1 - size * Math.sin(angle - spread);
  const bx = x1 - size * Math.cos(angle + spread);
  const by = y1 - size * Math.sin(angle + spread);

  return `M ${x1} ${y1} L ${ax} ${ay} L ${bx} ${by} Z`;
}
