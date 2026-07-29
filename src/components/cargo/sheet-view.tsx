import { Trash2 } from "lucide-react";
import {
  CONTAINER_SIZES,
  containerCount,
  groupByMission,
  LOW_CAPACITY_THRESHOLD,
  sumQuantities,
  totalVolume,
  type CargoLine,
} from "@/lib/cargo";
import { cn } from "@/lib/utils";

/** Box counts as «32 × 2 · 16 × 1», sizes with none left out. */
export function formatQuantities(quantities: number[]): string {
  const parts = CONTAINER_SIZES.map((size, index) =>
    quantities[index] > 0 ? `${size} × ${quantities[index]}` : null,
  ).filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "—";
}

/**
 * What is loaded against what the ship takes. The number that matters in
 * flight is the one left, so it is the one shown large.
 */
export function CapacitySummary({
  lines,
  capacity,
  shipName,
  compact = false,
}: {
  lines: CargoLine[];
  capacity: number;
  shipName: string;
  compact?: boolean;
}) {
  const used = totalVolume(lines);
  const remaining = capacity - used;
  const ratio = capacity > 0 ? Math.min(1, used / capacity) : 0;
  const over = remaining < 0;
  const tight = !over && remaining < LOW_CAPACITY_THRESHOLD;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <p
          className={cn(
            "truncate font-medium text-nexus-bright",
            compact ? "text-xs" : "text-sm",
          )}
        >
          {shipName}
        </p>
        <p
          className={cn(
            "shrink-0 tabular-nums",
            compact ? "text-xs" : "text-sm",
            over
              ? "text-red-300"
              : tight
                ? "text-amber-300"
                : "text-nexus-accent/70",
          )}
        >
          {used} / {capacity} SCU
          <span className="ml-2 text-nexus-bright/85">
            {over ? `${-remaining} en trop` : `${remaining} libres`}
          </span>
        </p>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-nexus-accent/10">
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            over
              ? "bg-red-400/80"
              : tight
                ? "bg-amber-400/80"
                : "bg-nexus-accent/70",
          )}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>

      <p className="text-[11px] text-nexus-accent/50">
        {lines.length} ligne{lines.length > 1 ? "s" : ""} ·{" "}
        {containerCount(sumQuantities(lines))} conteneurs ·{" "}
        {formatQuantities(sumQuantities(lines))}
      </p>
    </div>
  );
}

/**
 * The sheet itself, one block per mission. `compact` is the overlay: same
 * data, read at a glance over the game, without the buttons.
 */
export function MissionGroups({
  lines,
  compact = false,
  onRemoveLine,
  onRemoveMission,
}: {
  lines: CargoLine[];
  compact?: boolean;
  onRemoveLine?: (id: string) => void;
  onRemoveMission?: (mission: string) => void;
}) {
  const groups = groupByMission(lines);

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {groups.map((group) => (
        <div
          key={group.mission || "__unassigned__"}
          className="overflow-hidden rounded-lg border border-nexus-accent/15 bg-nexus-abyss/40"
        >
          <div className="flex items-center justify-between gap-2 border-b border-nexus-accent/10 px-3 py-1.5">
            <p className="truncate text-xs font-medium text-nexus-bright/90">
              {group.mission || "Sans mission"}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[11px] tabular-nums text-nexus-accent/60">
                {group.volume} SCU · {formatQuantities(group.quantities)}
              </span>
              {onRemoveMission && group.mission ? (
                <button
                  type="button"
                  title="Supprimer la mission"
                  onClick={() => onRemoveMission(group.mission)}
                  className="rounded p-1 text-nexus-accent/40 transition hover:bg-white/5 hover:text-red-300"
                >
                  <span className="sr-only">Supprimer la mission</span>
                  <Trash2 className="size-3" />
                </button>
              ) : null}
            </div>
          </div>

          <ul className="divide-y divide-nexus-accent/10">
            {group.lines.map((line) => (
              <li
                key={line.id}
                className="flex items-center gap-3 px-3 py-1.5 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-nexus-bright/90">
                    {line.destination}
                    {line.content ? (
                      <span className="text-nexus-accent/60">
                        {" "}
                        — {line.content}
                      </span>
                    ) : null}
                  </p>

                  {/* Narrow, the box counts go under the line rather than
                      beside it: they are what is read while loading, so they
                      are the last thing that should be dropped. */}
                  <div className="flex items-baseline gap-2 text-[11px] text-nexus-accent/50">
                    {line.location ? (
                      <span className="truncate">Depuis {line.location}</span>
                    ) : null}
                    {compact ? (
                      <span className="ml-auto shrink-0 tabular-nums">
                        {formatQuantities(line.quantities)}
                      </span>
                    ) : null}
                  </div>
                </div>

                <span className="shrink-0 tabular-nums text-nexus-accent/70">
                  {line.volume} SCU
                </span>

                {!compact ? (
                  <span className="shrink-0 tabular-nums text-nexus-accent/50">
                    {formatQuantities(line.quantities)}
                  </span>
                ) : null}

                {onRemoveLine ? (
                  <button
                    type="button"
                    title="Supprimer la ligne"
                    onClick={() => onRemoveLine(line.id)}
                    className="shrink-0 rounded p-1 text-nexus-accent/40 transition hover:bg-white/5 hover:text-red-300"
                  >
                    <span className="sr-only">Supprimer la ligne</span>
                    <Trash2 className="size-3" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
