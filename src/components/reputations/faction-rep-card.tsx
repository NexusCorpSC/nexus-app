import { useTranslations } from "use-intl";
import { getLocale } from "@/i18n/locale";
import { translator } from "@/i18n/translate";
import { Card, Modal } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  currentLevel,
  isMaxed,
  isStarted,
  levelTone,
  showsStanding,
} from "@/lib/reputations";
import type {
  FactionCareer,
  FactionLevel,
  PlayerReputations,
  RepFaction,
} from "@/types/nexus";

export type LevelChange = (career: FactionCareer, level: FactionLevel) => void;

const TONE_FILL = {
  below: "bg-orange-300/85",
  default: "bg-nexus-accent/45",
  progress: "bg-nexus-accent/85",
  top: "bg-amber-300/85",
};

const TONE_TEXT = {
  below: "text-orange-200",
  default: "text-nexus-dim",
  progress: "text-nexus-accent",
  top: "text-amber-300",
};

const formatRep = (value: number) => value.toLocaleString(getLocale());

function rankTitle(level: FactionLevel): string {
  return level.minReputation && level.minReputation > 0
    ? `${level.name} · ${formatRep(level.minReputation)}`
    : level.name;
}

/** Focus, legality and removal, as one line under the faction name. */
export function factionMeta(faction: RepFaction): string {
  const t = translator("Reputations.card");
  return [
    faction.focus,
    faction.lawful === undefined
      ? undefined
      : faction.lawful
        ? t("lawful")
        : t("unlawful"),
    faction.removedInVersion
      ? t("removed", { version: faction.removedInVersion })
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function FactionRepCard({
  faction,
  reputations,
  disabled,
  onOpen,
  onLevel,
}: {
  faction: RepFaction;
  reputations: PlayerReputations;
  disabled: boolean;
  onOpen: () => void;
  onLevel: LevelChange;
}) {
  const t = useTranslations("Reputations.card");
  const started = isStarted(faction, reputations);
  const maxed = isMaxed(faction, reputations);
  const meta = factionMeta(faction);
  const standing = reputations[faction.name]?.standing;

  return (
    <Card
      className={cn(
        "flex flex-col gap-3.5 p-4",
        started && "border-nexus-accent/30",
        maxed && "border-amber-300/45",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <button
            type="button"
            onClick={onOpen}
            className="text-left font-display text-base font-semibold text-nexus-white hover:text-nexus-accent hover:underline"
          >
            {faction.name}
          </button>
          {meta ? <span className="text-xs text-nexus-dim">{meta}</span> : null}
        </div>
        {maxed ? (
          <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-amber-300/55 bg-amber-300/15 px-2 text-[11px] font-semibold text-amber-200">
            {t("maxBadge")}
          </span>
        ) : showsStanding(faction) &&
          standing &&
          standing !== faction.defaultStanding ? (
          <span className="shrink-0 text-xs text-nexus-dim">{standing}</span>
        ) : null}
      </div>

      {faction.careers.length === 0 ? (
        <p className="text-xs text-nexus-dim">
          {t("noCareer")}
        </p>
      ) : (
        faction.careers.map((career) => (
          <CareerLadder
            key={career.name}
            faction={faction}
            career={career}
            level={currentLevel(faction, career, reputations)}
            disabled={disabled}
            onLevel={(level) => onLevel(career, level)}
          />
        ))
      )}
    </Card>
  );
}

// Compact native select: kept native so keyboard and screen readers work
// without extra code, restyled so the rank name reads as text.
const COMPACT_SELECT =
  "h-8 max-w-56 cursor-pointer rounded-md border border-transparent bg-transparent text-right text-[13px] font-semibold " +
  "hover:border-nexus-accent/25 focus:border-nexus-accent/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 " +
  "[&>option]:bg-nexus-abyss [&>option]:text-nexus-white";

function CareerLadder({
  faction,
  career,
  level,
  disabled,
  onLevel,
}: {
  faction: RepFaction;
  career: FactionCareer;
  level: FactionLevel | undefined;
  disabled: boolean;
  onLevel: (level: FactionLevel) => void;
}) {
  const t = useTranslations("Reputations.card");
  const tone = levelTone(career, level);
  const index = level
    ? career.levels.findIndex((option) => option.name === level.name)
    : -1;
  const defaultIndex = career.levels.findIndex((option) => option.isDefault);
  const next = index >= 0 ? career.levels[index + 1] : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[13px] text-nexus-bright">
          {career.name}
        </span>
        {/* The rank name is the select itself: what you read is what you change. */}
        <select
          aria-label={t("rankOf", { career: career.name, faction: faction.name })}
          className={cn(COMPACT_SELECT, TONE_TEXT[tone])}
          value={level?.name ?? ""}
          disabled={disabled}
          onChange={(event) => {
            const picked = career.levels.find(
              (option) => option.name === event.target.value,
            );
            if (picked) onLevel(picked);
          }}
        >
          {career.levels.map((option) => (
            <option key={option.name} value={option.name}>
              {option.name}
            </option>
          ))}
        </select>
      </div>

      <div
        role="group"
        aria-label={t("ladderOf", { career: career.name })}
        className="flex gap-0.5"
      >
        {career.levels.map((option, position) => {
          const filled =
            position <= index && (position >= defaultIndex || tone === "below");
          return (
            <button
              key={option.name}
              type="button"
              title={rankTitle(option)}
              aria-label={rankTitle(option)}
              aria-pressed={position === index}
              disabled={disabled}
              onClick={() => onLevel(option)}
              className="group flex h-7 flex-1 items-center disabled:cursor-not-allowed"
            >
              <span
                className={cn(
                  "block h-2.5 w-full rounded-full bg-white/8 group-hover:outline group-hover:outline-2 group-hover:outline-offset-2 group-hover:outline-nexus-accent/55 group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-nexus-accent",
                  position === defaultIndex &&
                    "ring-1 ring-inset ring-nexus-accent/35",
                  filled && TONE_FILL[tone],
                )}
              />
            </button>
          );
        })}
      </div>

      <span className="text-xs text-nexus-dim">
        {next
          ? next.minReputation && next.minReputation >= 10
            ? t("nextRankWithRep", {
                rank: next.name,
                rep: formatRep(next.minReputation),
              })
            : t("nextRank", { rank: next.name })
          : t("topRank")}
      </span>
    </div>
  );
}

/** The whole ladder of each career, with the reputation each rank needs. */
export function FactionRepModal({
  faction,
  reputations,
  disabled,
  onClose,
  onLevel,
  onStanding,
}: {
  faction: RepFaction | undefined;
  reputations: PlayerReputations;
  disabled: boolean;
  onClose: () => void;
  onLevel: LevelChange;
  onStanding: (standing: string) => void;
}) {
  const t = useTranslations("Reputations.card");
  if (!faction) return null;
  const meta = [factionMeta(faction), faction.headquarters]
    .filter(Boolean)
    .join(" · ");
  const standing =
    reputations[faction.name]?.standing ?? faction.defaultStanding;

  return (
    <Modal
      open
      title={faction.name}
      description={meta || undefined}
      onClose={onClose}
    >
      <div className="flex flex-col gap-5">
        {faction.description ? (
          <p className="text-sm leading-relaxed text-nexus-soft">
            {faction.description}
          </p>
        ) : null}

        {showsStanding(faction) ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] font-semibold text-nexus-bright">
              {t("standing")}
            </legend>
            <div className="flex gap-1.5">
              {faction.standings.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={standing === option}
                  disabled={disabled}
                  onClick={() => onStanding(option)}
                  className={cn(
                    "h-10 flex-1 rounded-lg border border-nexus-accent/20 text-[13px] font-medium text-nexus-muted",
                    standing === option &&
                      (option === "Hostile"
                        ? "border-orange-300 bg-orange-300/10 text-orange-200"
                        : "border-nexus-accent bg-nexus-accent/10 text-nexus-white"),
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}

        {faction.careers.map((career) => {
          const level = currentLevel(faction, career, reputations);
          const index = level
            ? career.levels.findIndex((option) => option.name === level.name)
            : -1;
          const defaultIndex = career.levels.findIndex(
            (option) => option.isDefault,
          );
          const tone = levelTone(career, level);
          return (
            <fieldset key={career.name} className="flex flex-col gap-1">
              <legend className="mb-2 flex w-full justify-between text-[13px] font-semibold text-nexus-bright">
                <span>{career.name}</span>
                <span className="font-medium text-nexus-dim">
                  {t("requiredRep")}
                </span>
              </legend>
              {[...career.levels].reverse().map((option) => {
                const position = career.levels.indexOf(option);
                const checked = position === index;
                const reached =
                  position <= index &&
                  (position >= defaultIndex || tone === "below");
                return (
                  <label
                    key={option.name}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-transparent px-3 text-sm text-nexus-white hover:bg-nexus-accent/5 has-[:focus-visible]:border-nexus-accent",
                      checked &&
                        "border-nexus-accent bg-nexus-accent/10 font-semibold",
                      checked && tone === "top" && "border-amber-300",
                    )}
                  >
                    <input
                      type="radio"
                      name={`rank-${career.name}`}
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onLevel(career, option)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden
                      className={cn(
                        "size-2.5 shrink-0 rounded-full ring-2 ring-inset ring-nexus-accent/30",
                        reached && cn(TONE_FILL[tone], "ring-0"),
                      )}
                    />
                    <span className="flex-1">
                      {option.name}
                      {option.isDefault ? (
                        <span className="ml-2 text-xs font-normal text-nexus-dim">
                          {t("startingRank")}
                        </span>
                      ) : null}
                    </span>
                    <span className="font-mono text-[13px] font-normal text-nexus-dim">
                      {option.minReputation && option.minReputation > 0
                        ? formatRep(option.minReputation)
                        : "—"}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          );
        })}
      </div>
    </Modal>
  );
}
