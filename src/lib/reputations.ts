import type {
  FactionCareer,
  FactionLevel,
  PlayerReputations,
  RepFaction as Faction,
} from "@/types/nexus";

// Same rules as the site's /reps page (nexus-tools `lib/reputations-view.ts`):
// keep both in step.

/** The groups the reputations page sorts factions into. */
export type CareerFamily = "guild" | "hauling" | "faction" | "trade";

export const CAREER_FAMILIES: CareerFamily[] = [
  "guild",
  "hauling",
  "faction",
  "trade",
];

/**
 * A career's group, from its in-game ladder key when the import set it,
 * otherwise from its name.
 */
export function careerFamily(career: FactionCareer): CareerFamily {
  const key = `${career.gameScope ?? ""} ${career.name}`.toLowerCase();
  if (/factionreputation|missionproviderreputation|\bstanding\b/.test(key))
    return "faction";
  if (/hauling/.test(key)) return "hauling";
  if (/wikelo|barter|trade/.test(key)) return "trade";
  return "guild";
}

export function factionFamily(faction: Faction): CareerFamily {
  return faction.careers[0] ? careerFamily(faction.careers[0]) : "faction";
}

/**
 * The Hostile / Neutral / Ally standing duplicates a "Standing" ladder,
 * which already runs from Hostile to Elite Contractor: hide it there.
 */
export function showsStanding(faction: Faction): boolean {
  return (
    faction.standings.length > 0 &&
    !faction.careers.some((career) => careerFamily(career) === "faction")
  );
}

export function defaultLevel(career: FactionCareer): FactionLevel | undefined {
  return career.levels.find((level) => level.isDefault) ?? career.levels[0];
}

/**
 * The rank the player picked: their saved copy is matched by its in-game
 * key, then by name; with no pick, the default rank.
 */
export function currentLevel(
  faction: Faction,
  career: FactionCareer,
  reputations: PlayerReputations,
): FactionLevel | undefined {
  const saved = reputations[faction.name]?.careers?.[career.name]?.level;
  if (saved) {
    const found =
      (saved.gameName
        ? career.levels.find((level) => level.gameName === saved.gameName)
        : undefined) ??
      career.levels.find((level) => level.name === saved.name);
    if (found) return found;
  }
  return defaultLevel(career);
}

/** Started: a rank above (or below) the default, or a changed standing. */
export function isStarted(
  faction: Faction,
  reputations: PlayerReputations,
): boolean {
  const standing = reputations[faction.name]?.standing;
  if (
    showsStanding(faction) &&
    standing &&
    standing !== faction.defaultStanding
  )
    return true;
  return faction.careers.some((career) => {
    const level = currentLevel(faction, career, reputations);
    return level ? !level.isDefault : false;
  });
}

export function isMaxed(
  faction: Faction,
  reputations: PlayerReputations,
): boolean {
  return faction.careers.some((career) => {
    const level = currentLevel(faction, career, reputations);
    return (
      !!level &&
      career.levels.length > 1 &&
      career.levels[career.levels.length - 1].name === level.name
    );
  });
}

/** Lowercase and strip accents, so "securite" finds "Sécurité". */
export function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function matchesSearch(faction: Faction, needle: string): boolean {
  if (!needle) return true;
  return [
    faction.name,
    ...faction.careers.flatMap((career) => [
      career.name,
      ...career.levels.map((level) => level.name),
    ]),
  ].some((text) => fold(text).includes(needle));
}

/**
 * How a rank reads on its bar: below the default (Hostile, Not Eligible),
 * the default, progress, or one of the last two ranks of a long ladder
 * (the last of a short one).
 */
export function levelTone(
  career: FactionCareer,
  level: FactionLevel | undefined,
): "below" | "default" | "progress" | "top" {
  if (!level || level.isDefault) return "default";
  if (level.level < 0) return "below";
  const index = career.levels.findIndex((option) => option.name === level.name);
  const count = career.levels.length;
  const threshold = count >= 4 ? count - 2 : count - 1;
  return index >= threshold ? "top" : "progress";
}
