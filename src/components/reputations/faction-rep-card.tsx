import type { ReputationUpdate } from "@/lib/api/reps";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";
import type {
  FactionCareer,
  FactionLevel,
  PlayerReputations,
  RepFaction,
} from "@/types/nexus";

/** The level a player holds in a career, falling back to its default. */
export function currentCareerLevel(
  career: FactionCareer,
  reputations: PlayerReputations,
  factionName: string,
): FactionLevel | undefined {
  return (
    reputations[factionName]?.careers?.[career.name]?.level ??
    career.levels.find((level) => level.isDefault) ??
    career.levels[0]
  );
}

/**
 * A faction counts as started once the player moved away from any default:
 * a standing other than the faction's, or a career above its default level.
 */
export function isFactionStarted(
  faction: RepFaction,
  reputations: PlayerReputations,
): boolean {
  const standing = reputations[faction.name]?.standing;
  if (standing && standing !== faction.defaultStanding) return true;

  return faction.careers.some((career) => {
    const level = currentCareerLevel(career, reputations, faction.name);
    return level ? !level.isDefault : false;
  });
}

// Compact native selects: kept native so keyboard and screen readers work
// without extra code, restyled so they read as text inside a dense card.
const COMPACT_SELECT =
  "cursor-pointer rounded-md border border-nexus-accent/15 bg-nexus-abyss/60 px-2 py-1 text-xs " +
  "focus:border-nexus-accent/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 " +
  "[&>option]:bg-nexus-abyss [&>option]:text-nexus-white";

export function FactionRepCard({
  faction,
  reputations,
  disabled,
  onChange,
}: {
  faction: RepFaction;
  reputations: PlayerReputations;
  disabled: boolean;
  onChange: (update: ReputationUpdate) => void;
}) {
  const standing =
    reputations[faction.name]?.standing ?? faction.defaultStanding;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 pt-3 font-display text-base font-semibold text-nexus-white">
          {faction.name}
        </h2>

        <label className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-nexus-dim">
            Standing
          </span>
          <select
            className={cn(COMPACT_SELECT, "max-w-40 text-nexus-white")}
            value={standing}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                factionName: faction.name,
                standing: event.target.value,
              })
            }
          >
            {faction.standings.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      {faction.careers.length === 0 ? (
        <p className="text-xs text-nexus-dim">
          Aucune carrière pour cette faction.
        </p>
      ) : (
        <div className="flex flex-col gap-3.5">
          {faction.careers.map((career) => (
            <CareerRow
              key={career.name}
              career={career}
              level={currentCareerLevel(career, reputations, faction.name)}
              disabled={disabled}
              onChange={(levelName) =>
                onChange({
                  factionName: faction.name,
                  careerName: career.name,
                  levelName,
                })
              }
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function CareerRow({
  career,
  level,
  disabled,
  onChange,
}: {
  career: FactionCareer;
  level: FactionLevel | undefined;
  disabled: boolean;
  onChange: (levelName: string) => void;
}) {
  const index = level
    ? career.levels.findIndex((option) => option.name === level.name)
    : -1;
  const count = career.levels.length;
  // The last two ranks of a long ladder (only the last of a short one) are
  // the rare ones worth singling out in amber.
  const topThreshold = count >= 4 ? count - 2 : count - 1;
  const isTop = index >= 0 && index >= topThreshold;
  const isDefault = !level || level.isDefault;

  const tone = isDefault
    ? "text-nexus-dim"
    : isTop
      ? "text-amber-300"
      : "text-nexus-accent";
  const fill = isDefault
    ? "bg-nexus-dim/45"
    : isTop
      ? "bg-amber-300/80"
      : "bg-nexus-accent/80";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[13px] text-nexus-bright">
          {career.name}
        </span>
        {/* The level name is the select itself: what you read is what you
            change, without a second control under the bar. */}
        <select
          aria-label={`Niveau ${career.name}`}
          className={cn(
            COMPACT_SELECT,
            "max-w-44 border-transparent bg-transparent py-0.5 text-right font-medium hover:border-nexus-accent/25",
            tone,
          )}
          value={level?.name ?? ""}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {career.levels.map((option) => (
            <option key={option.name} value={option.name}>
              {option.name}
            </option>
          ))}
        </select>
      </div>

      {count > 0 ? (
        <div className="flex gap-0.5" aria-hidden>
          {career.levels.map((option, position) => (
            <span
              key={option.name}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                position <= index ? fill : "bg-white/8",
              )}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
