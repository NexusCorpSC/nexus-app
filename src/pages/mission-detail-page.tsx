import { Link, useParams } from "react-router-dom";
import { BackLink } from "@/components/layout/back-link";
import { useQuery } from "@tanstack/react-query";
import { Box, Check, Share2 } from "lucide-react";
import { getMission } from "@/lib/api/missions";
import {
  Card,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionTitle,
} from "@/components/ui";
import { IllegalPill } from "@/components/missions/mission-card";
import { formatUEC } from "@/lib/utils";

export default function MissionDetailPage() {
  const { missionId = "" } = useParams();

  const missionQuery = useQuery({
    queryKey: ["mission", missionId],
    queryFn: () => getMission(missionId),
    enabled: Boolean(missionId),
  });

  if (missionQuery.isPending) return <LoadingState />;

  if (missionQuery.isError) {
    return (
      <>
        <BackLink to="/missions">Retour aux missions</BackLink>
        <ErrorState
          error={missionQuery.error}
          onRetry={() => void missionQuery.refetch()}
        />
      </>
    );
  }

  const mission = missionQuery.data;
  const blueprints = mission.blueprintDetails ?? [];
  // `owned` only comes back for a signed-in reader, as on the site.
  const ownershipKnown = blueprints.some(
    (blueprint) => blueprint.owned !== undefined,
  );
  const ownedCount = blueprints.filter((blueprint) => blueprint.owned).length;

  const details: { label: string; value: string; className?: string }[] = [
    { label: "Faction", value: mission.faction?.name ?? "—" },
    { label: "Catégorie", value: mission.category ?? "—" },
    { label: "Type", value: mission.missionType ?? "—" },
    {
      label: "Récompense",
      value: formatUEC(mission.rewardUEC),
      // Same amber as the grid card, so the reward is recognised at a glance.
      className: mission.rewardUEC
        ? "text-right font-semibold text-amber-300"
        : undefined,
    },
  ];

  return (
    <>
      <BackLink to="/missions">Retour aux missions</BackLink>

      {mission.missionType ? (
        <p className="mb-1 text-[10.5px] font-semibold tracking-wider text-sky-300/80 uppercase">
          {mission.missionType}
        </p>
      ) : null}
      <PageHeader
        title={mission.title}
        description={mission.faction?.name}
        actions={
          mission.illegal || mission.canBeShared ? (
            <>
              {mission.illegal ? <IllegalPill /> : null}
              {mission.canBeShared ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                  <Share2 className="size-3" />
                  Partageable
                </span>
              ) : null}
            </>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {mission.description ? (
            <Card className="p-5">
              <SectionTitle>Briefing</SectionTitle>
              <p className="text-sm leading-relaxed whitespace-pre-line text-nexus-muted">
                {mission.description}
              </p>
            </Card>
          ) : null}

          <section>
            <SectionTitle
              aside={
                !blueprints.length
                  ? undefined
                  : ownershipKnown
                    ? `${ownedCount} / ${blueprints.length} possédé${ownedCount > 1 ? "s" : ""}`
                    : `${blueprints.length} blueprint${blueprints.length > 1 ? "s" : ""}`
              }
            >
              Blueprints débloqués
            </SectionTitle>

            {blueprints.length ? (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {blueprints.map((blueprint) => (
                  <Link
                    key={blueprint._id}
                    to={`/blueprints/${blueprint.slug}`}
                    className="flex items-start gap-2.5 rounded-xl border border-nexus-accent/12 bg-nexus-card p-3 transition-colors hover:border-nexus-accent/35"
                  >
                    <Box className="mt-0.5 size-4 shrink-0 text-violet-300" />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-[13px] font-medium text-nexus-white">
                        {blueprint.name}
                      </p>
                      {blueprint.category ? (
                        <p className="mt-0.5 truncate text-[11px] text-nexus-dim">
                          {blueprint.category}
                          {blueprint.subcategory
                            ? ` · ${blueprint.subcategory}`
                            : ""}
                        </p>
                      ) : null}
                    </div>
                    {blueprint.owned !== undefined ? (
                      <OwnershipPill owned={blueprint.owned} />
                    ) : null}
                  </Link>
                ))}
              </div>
            ) : (
              <Card className="p-4">
                <p className="text-xs text-nexus-dim">
                  Cette mission ne débloque aucun blueprint.
                </p>
              </Card>
            )}
          </section>
        </div>

        <Card className="h-fit p-5">
          <SectionTitle>Détails</SectionTitle>
          <dl className="space-y-2.5 text-[13px]">
            {details.map((detail) => (
              <div key={detail.label} className="flex justify-between gap-3">
                <dt className="text-nexus-dim">{detail.label}</dt>
                <dd
                  className={detail.className ?? "text-right text-nexus-white"}
                >
                  {detail.value}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}

/** Same wording as the site's mission fiche. */
function OwnershipPill({ owned }: { owned: boolean }) {
  return owned ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
      <Check className="size-3" />
      Possédé
    </span>
  ) : (
    <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-nexus-dim">
      Non possédé
    </span>
  );
}
