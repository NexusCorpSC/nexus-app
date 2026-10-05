import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listMissionFactions, listMissions } from "@/lib/api/missions";
import { useDebounced } from "@/hooks/use-debounced";
import {
  pageFrom,
  useInitialParams,
  useUrlFilters,
} from "@/hooks/use-url-filters";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Pagination,
  SearchField,
  Toolbar,
  ToolbarSelect,
  ToolbarToggle,
} from "@/components/ui";
import { MissionCard } from "@/components/missions/mission-card";

export default function MissionsPage() {
  const params = useInitialParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [factionId, setFactionId] = useState(params.get("faction") ?? "");
  const [hasBlueprints, setHasBlueprints] = useState(
    params.get("blueprints") === "true",
  );
  const [page, setPage] = useState(() => pageFrom(params));

  const query = useDebounced(search);
  useUrlFilters({
    q: query,
    faction: factionId,
    blueprints: hasBlueprints,
    page,
  });

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

  // Any filter change invalidates the current page number.
  function updateFilter(apply: () => void) {
    apply();
    setPage(1);
  }

  const data = missionsQuery.data;

  return (
    <>
      <PageHeader
        title="Missions"
        description="Parcourez les missions, leurs factions et les blueprints qu'elles débloquent."
      />

      <Toolbar>
        <SearchField
          label="Rechercher une mission"
          placeholder="Titre ou description…"
          value={search}
          onChange={(event) =>
            updateFilter(() => setSearch(event.target.value))
          }
        />
        <ToolbarSelect
          label="Faction"
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
        </ToolbarSelect>
        <ToolbarToggle
          label="Avec blueprints"
          checked={hasBlueprints}
          onChange={(checked) => updateFilter(() => setHasBlueprints(checked))}
        />
        {data && data.total > 0 ? (
          <span className="ml-auto text-xs text-nexus-dim">
            {data.missions.length} sur {data.total.toLocaleString("fr-FR")}{" "}
            mission{data.total > 1 ? "s" : ""}
          </span>
        ) : null}
      </Toolbar>

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
          {/* Dim the previous page while the next one loads, rather than
              flashing a spinner over a grid the user is reading. */}
          <div
            className={
              missionsQuery.isPlaceholderData
                ? "opacity-60 transition-opacity"
                : "transition-opacity"
            }
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {missionsQuery.data.missions.map((mission) => (
                <MissionCard key={mission._id} mission={mission} />
              ))}
            </div>
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
