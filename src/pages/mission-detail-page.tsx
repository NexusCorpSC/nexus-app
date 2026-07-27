import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { getMission } from "@/lib/api/missions";
import {
  Badge,
  Card,
  ErrorState,
  LoadingState,
  PageHeader,
} from "@/components/ui";
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
      <ErrorState
        error={missionQuery.error}
        onRetry={() => void missionQuery.refetch()}
      />
    );
  }

  const mission = missionQuery.data;

  return (
    <>
      <Link
        to="/missions"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-nexus-accent/60 transition-colors hover:text-nexus-accent"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Retour aux missions
      </Link>

      <PageHeader
        title={mission.title}
        description={mission.faction?.name}
        actions={
          <div className="flex gap-2">
            {mission.illegal ? <Badge tone="warning">Illégale</Badge> : null}
            {mission.canBeShared ? <Badge>Partageable</Badge> : null}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {mission.description ? (
            <Card className="p-5">
              <h2 className="mb-2 text-sm font-semibold text-nexus-bright">
                Briefing
              </h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-nexus-accent/75">
                {mission.description}
              </p>
            </Card>
          ) : null}

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-nexus-bright">
              Blueprints débloqués
            </h2>

            {mission.blueprintDetails?.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {mission.blueprintDetails.map((blueprint) => (
                  <Link
                    key={blueprint._id}
                    to={`/blueprints/${blueprint.slug}`}
                    className="rounded-lg border border-nexus-accent/10 bg-nexus-abyss/40 p-3 transition-colors hover:border-nexus-accent/35"
                  >
                    <p className="text-sm text-nexus-bright">{blueprint.name}</p>
                    {blueprint.category ? (
                      <p className="mt-0.5 text-[11px] text-nexus-accent/50">
                        {blueprint.category}
                        {blueprint.subcategory
                          ? ` · ${blueprint.subcategory}`
                          : ""}
                      </p>
                    ) : null}
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-xs text-nexus-accent/50">
                Cette mission ne débloque aucun blueprint.
              </p>
            )}
          </Card>
        </div>

        <Card className="h-fit p-5">
          <h2 className="mb-3 text-sm font-semibold text-nexus-bright">
            Détails
          </h2>
          <dl className="space-y-2 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-nexus-accent/50">Faction</dt>
              <dd className="text-nexus-bright/85">
                {mission.faction?.name ?? "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-nexus-accent/50">Catégorie</dt>
              <dd className="text-nexus-bright/85">{mission.category ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-nexus-accent/50">Type</dt>
              <dd className="text-nexus-bright/85">
                {mission.missionType ?? "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-nexus-accent/50">Récompense</dt>
              <dd className="text-nexus-bright/85">
                {formatUEC(mission.rewardUEC)}
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </>
  );
}
