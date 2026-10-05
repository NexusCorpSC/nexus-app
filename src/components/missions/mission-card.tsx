import { Link } from "react-router-dom";
import { Box, Flag, Share2, ShieldAlert } from "lucide-react";
import { useTranslations } from "use-intl";
import { formatUEC } from "@/lib/utils";
import type { Mission } from "@/types/nexus";

/** A pill flagging an illegal mission; shared with the detail page. */
export function IllegalPill() {
  const t = useTranslations("Missions");
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-red-300/30 bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300">
      <ShieldAlert className="size-3" />
      {t("illegal")}
    </span>
  );
}

/**
 * One mission in the grid, laid out like the website's card so players who
 * use both read it the same way: type and title, description, then the facts
 * that decide whether to take it (faction, reward, sharing, blueprints).
 */
export function MissionCard({ mission }: { mission: Mission }) {
  const t = useTranslations("Missions");
  const blueprintCount = mission.blueprintDetails?.length ?? 0;

  return (
    <Link
      to={`/missions/${mission._id}`}
      className="flex flex-col gap-2 rounded-xl border border-nexus-accent/12 bg-nexus-card p-4 transition-colors hover:border-nexus-accent/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nexus-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {mission.missionType ? (
            <p className="text-[10.5px] font-semibold tracking-wider text-sky-300/80 uppercase">
              {mission.missionType}
            </p>
          ) : null}
          <h3 className="line-clamp-2 text-sm font-semibold text-nexus-white">
            {mission.title}
          </h3>
        </div>
        {mission.illegal ? <IllegalPill /> : null}
      </div>

      {mission.description ? (
        <p className="line-clamp-2 text-[12.5px] text-nexus-muted">
          {mission.description}
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap gap-3 border-t border-white/5 pt-2 text-xs">
        {mission.faction?.name ? (
          <span className="inline-flex items-center gap-1 text-sky-300">
            <Flag className="size-3.5" />
            {mission.faction.name}
          </span>
        ) : null}
        {mission.rewardUEC ? (
          <span className="font-semibold text-amber-300">
            {formatUEC(mission.rewardUEC)}
          </span>
        ) : null}
        {mission.canBeShared ? (
          <span className="inline-flex items-center gap-1 text-emerald-300">
            <Share2 className="size-3.5" />
            {t("shareable")}
          </span>
        ) : null}
        {blueprintCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-violet-300">
            <Box className="size-3.5" />
            {t("blueprintCount", { count: blueprintCount })}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
