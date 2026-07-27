import { useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listMissionFactions, listMissions } from "@/lib/api/missions";
import { useDebounced } from "@/hooks/use-debounced";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Pagination,
  Select,
} from "@/components/ui";
import { formatUEC } from "@/lib/utils";

export default function MissionsPage() {
  const [search, setSearch] = useState("");
  const [factionId, setFactionId] = useState("");
  const [hasBlueprints, setHasBlueprints] = useState(false);
  const [page, setPage] = useState(1);

  const query = useDebounced(search);

  const factionsQuery = useQuery({
    queryKey: ["mission-factions"],
    queryFn: listMissionFactions,
    staleTime: 30 * 60_000,
  });

  const missionsQuery = useQuery({
    queryKey: ["missions", query, factionId, hasBlueprints, page],
    queryFn: () =>
      listMissions({
        query: query || undefined,
        factionId: factionId || undefined,
        hasBlueprints,
        page,
      }),
    placeholderData: keepPreviousData,
  });

  function updateFilter(apply: () => void) {
    apply();
    setPage(1);
  }

  return (
    <>
      <PageHeader
        title="Missions"
        description="Parcourez les missions, leurs factions et les blueprints qu'elles débloquent."
      />

      <Card className="mb-6 p-4">
        <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Recherche">
            <Input
              value={search}
              placeholder="Titre ou description…"
              onChange={(event) =>
                updateFilter(() => setSearch(event.target.value))
              }
            />
          </Field>

          <Field label="Faction">
            <Select
              value={factionId}
              onChange={(event) =>
                updateFilter(() => setFactionId(event.target.value))
              }
            >
              <option value="">Toutes</option>
              {factionsQuery.data?.map((faction) => (
                <option key={faction._id} value={faction._id}>
                  {faction.name}
                  {faction.missionCount ? ` (${faction.missionCount})` : ""}
                </option>
              ))}
            </Select>
          </Field>

          <label className="flex items-center gap-2 pb-2 text-sm text-nexus-accent/75">
            <input
              type="checkbox"
              checked={hasBlueprints}
              onChange={(event) =>
                updateFilter(() => setHasBlueprints(event.target.checked))
              }
              className="h-4 w-4 rounded border-nexus-accent/30 bg-nexus-abyss accent-nexus-accent"
            />
            Avec blueprints uniquement
          </label>
        </div>
      </Card>

      {missionsQuery.isPending ? (
        <LoadingState />
      ) : missionsQuery.isError ? (
        <ErrorState
          error={missionsQuery.error}
          onRetry={() => void missionsQuery.refetch()}
        />
      ) : missionsQuery.data.missions.length === 0 ? (
        <EmptyState
          title="Aucune mission trouvée"
          description="Modifiez la recherche ou changez de faction."
        />
      ) : (
        <>
          <p className="mb-3 text-xs text-nexus-accent/50">
            {missionsQuery.data.total} mission
            {missionsQuery.data.total > 1 ? "s" : ""}
          </p>

          <div className="space-y-3">
            {missionsQuery.data.missions.map((mission) => (
              <Link key={mission._id} to={`/missions/${mission._id}`}>
                <Card className="p-4 transition-colors hover:border-nexus-accent/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-nexus-bright">
                        {mission.title}
                      </p>
                      <p className="mt-0.5 text-xs text-nexus-accent/50">
                        {mission.faction?.name ?? "Faction inconnue"}
                        {mission.missionType ? ` · ${mission.missionType}` : ""}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {mission.illegal ? (
                        <Badge tone="warning">Illégale</Badge>
                      ) : null}
                      {mission.blueprintDetails?.length ? (
                        <Badge>
                          {mission.blueprintDetails.length} blueprint
                          {mission.blueprintDetails.length > 1 ? "s" : ""}
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  {mission.description ? (
                    <p className="mt-2 line-clamp-2 text-xs text-nexus-accent/65">
                      {mission.description}
                    </p>
                  ) : null}

                  {mission.rewardUEC ? (
                    <p className="mt-2 text-[11px] text-nexus-accent/45">
                      Récompense : {formatUEC(mission.rewardUEC)}
                    </p>
                  ) : null}
                </Card>
              </Link>
            ))}
          </div>

          <Pagination
            page={missionsQuery.data.page}
            totalPages={missionsQuery.data.totalPages}
            onPageChange={setPage}
          />
        </>
      )}
    </>
  );
}
