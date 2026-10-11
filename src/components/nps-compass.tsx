import { useRef } from "react";
import { useTranslations } from "use-intl";

import type { Guidance } from "@/lib/nps";
import { cn } from "@/lib/utils";

/** Under this, the destination is straight ahead: the needle turns green. */
export const AHEAD_DEGREES = 10;

const CARDINALS = [
  { key: "n", bearing: 0 },
  { key: "e", bearing: 90 },
  { key: "s", bearing: 180 },
  { key: "w", bearing: 270 },
] as const;

const RING = 50;
const TICKS = Array.from({ length: 24 }, (_, index) => index * 15);

/**
 * Follows `angle` the short way round: from 350° to 10°, through 360°, not
 * back through 180°, so the needle does not spin when it eases to its place.
 */
function useContinuousAngle(angle: number): number {
  const last = useRef(angle);
  const delta = ((((angle - last.current) % 360) + 540) % 360) - 180;
  last.current += delta;
  return last.current;
}

/**
 * A compass whose needle points at the destination.
 *
 * On a body, once two readings give the way one is going, the dial turns with
 * it: up is straight ahead, as on a car's GPS, and the needle says how far to
 * turn and to which side. Before that, up is north and the needle shows the
 * bearing to follow, to match against the heading on the ship's HUD. In
 * space, nothing gives a north nor a side: the needle stays up and a wedge
 * shows how far off the trajectory the destination lies.
 */
export function NpsCompass({ guidance }: { guidance: Guidance }) {
  const t = useTranslations("NpsOverlay");
  const { surface, turn } = guidance;

  const travelUp = Boolean(surface && turn?.signed);
  const cone = !surface && turn && !turn.signed ? turn.degrees : null;
  // Where the needle points, clockwise from the top of the dial, and how far
  // the dial turns so that north sits where it is.
  const needle = travelUp ? turn!.degrees : surface ? surface.heading : 0;
  const dial = travelUp ? turn!.degrees - surface!.heading : 0;
  const shown = surface || cone !== null;

  const needleAngle = useContinuousAngle(needle);
  const dialAngle = useContinuousAngle(dial);

  if (!shown) return null;

  const offBy = cone ?? (travelUp ? Math.abs(turn!.degrees) : null);
  const onCourse = offBy !== null && offBy < AHEAD_DEGREES;

  return (
    <figure className="flex flex-col items-center gap-1 py-1">
      <svg
        viewBox="-60 -60 120 120"
        className="size-32"
        role="img"
        aria-label={
          travelUp
            ? t("dial.travelUpLabel")
            : surface
              ? t("dial.northUpLabel")
              : t("dial.spaceLabel")
        }
      >
        <circle
          r={RING}
          className="fill-black/30 stroke-white/15"
          strokeWidth={1}
        />

        {cone !== null ? (
          <path
            d={wedge(Math.min(cone, 179.5))}
            className={onCourse ? "fill-emerald-300/20" : "fill-amber-300/20"}
          />
        ) : null}

        {/* Le cadran : graduations et points cardinaux, tournés avec le cap. */}
        {surface ? (
          <g
            style={{
              transform: `rotate(${dialAngle}deg)`,
              transition: "transform 600ms ease-out",
            }}
          >
            {TICKS.map((bearing) => (
              <line
                key={bearing}
                x1={0}
                y1={-RING}
                x2={0}
                y2={-RING + (bearing % 90 === 0 ? 7 : 4)}
                transform={`rotate(${bearing})`}
                className={bearing === 0 ? "stroke-red-400" : "stroke-white/30"}
                strokeWidth={bearing % 90 === 0 ? 1.5 : 1}
              />
            ))}
            {CARDINALS.map(({ key, bearing }) => (
              <g key={key} transform={`rotate(${bearing}) translate(0 -36)`}>
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{
                    transform: `rotate(${-bearing - dialAngle}deg)`,
                    transition: "transform 600ms ease-out",
                  }}
                  className={cn(
                    "text-[10px] font-semibold",
                    key === "n" ? "fill-red-300" : "fill-slate-400",
                  )}
                >
                  {t(`compass.${key}`)}
                </text>
              </g>
            ))}
          </g>
        ) : null}

        {/* Le repère du haut : la direction où l'on va, ou le nord. */}
        {travelUp || cone !== null ? (
          <path d="M0 -58 L-4 -51 L4 -51 Z" className="fill-slate-200" />
        ) : null}

        <g
          style={{
            transform: `rotate(${needleAngle}deg)`,
            transition: "transform 600ms ease-out",
          }}
        >
          <path
            d="M0 -44 L9 6 L0 0 L-9 6 Z"
            className={onCourse ? "fill-emerald-300" : "fill-sky-300"}
          />
          <path d="M0 0 L9 6 L0 14 L-9 6 Z" className="fill-white/20" />
        </g>
        <circle r={2.5} className="fill-slate-200" />
      </svg>
      <figcaption className="text-[11px] text-slate-500">
        {travelUp
          ? t("dial.travelUp")
          : surface
            ? t("dial.northUp")
            : t("dial.space")}
      </figcaption>
    </figure>
  );
}

/** The slice of the ring within `degrees` of the top, either side. */
function wedge(degrees: number): string {
  const radians = (degrees * Math.PI) / 180;
  const x = Math.sin(radians) * RING;
  const y = -Math.cos(radians) * RING;
  const large = degrees > 90 ? 1 : 0;
  return `M0 0 L${-x} ${y} A${RING} ${RING} 0 ${large} 1 ${x} ${y} Z`;
}
