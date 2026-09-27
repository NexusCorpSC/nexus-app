import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPlayerReputations,
  listRepFactions,
  updatePlayerReputation,
  type ReputationUpdate,
} from "@/lib/api/reps";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SearchField,
  Segmented,
  Spinner,
  Toolbar,
} from "@/components/ui";
import {
  FactionRepCard,
  isFactionStarted,
} from "@/components/reputations/faction-rep-card";
import type { RepFaction } from "@/types/nexus";

type Progress = "all" | "started";

/** Lowercase and strip accents, so "securite" finds "Sécurité". */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function matchesSearch(faction: RepFaction, needle: string): boolean {
  if (!needle) return true;
  return (
    fold(faction.name).includes(needle) ||
    faction.careers.some((career) => fold(career.name).includes(needle))
  );
}

export default function ReputationsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [progress, setProgress] = useState<Progress>("all");

  const factionsQuery = useQuery({
    queryKey: ["rep-factions"],
    queryFn: listRepFactions,
    staleTime: 30 * 60_000,
  });

  const reputationsQuery = useQuery({
    queryKey: ["player-reputations"],
    queryFn: getPlayerReputations,
  });

  const mutation = useMutation({
    mutationFn: (update: ReputationUpdate) => updatePlayerReputation(update),
    onSuccess: (reputations) => {
      // The endpoint returns the full updated map, so we seed the cache
      // instead of triggering a refetch.
      queryClient.setQueryData(["player-reputations"], reputations);
    },
  });

  // The faction list is small and already loaded, so filtering stays
  // client-side: instant, and no endpoint needs a search parameter.
  const visibleFactions = useMemo(() => {
    const factions = factionsQuery.data ?? [];
    const reputations = reputationsQuery.data ?? {};
    const needle = fold(search.trim());
    return factions.filter(
      (faction) =>
        matchesSearch(faction, needle) &&
        (progress === "all" || isFactionStarted(faction, reputations)),
    );
  }, [factionsQuery.data, reputationsQuery.data, search, progress]);

  if (factionsQuery.isPending || reputationsQuery.isPending) {
    return <LoadingState />;
  }

  if (factionsQuery.isError) {
    return (
      <ErrorState
        error={factionsQuery.error}
        onRetry={() => void factionsQuery.refetch()}
      />
    );
  }

  if (reputationsQuery.isError) {
    return (
      <ErrorState
        error={reputationsQuery.error}
        onRetry={() => void reputationsQuery.refetch()}
      />
    );
  }

  const factions = factionsQuery.data;
  const reputations = reputationsQuery.data;
  const count = visibleFactions.length;

  return (
    <>
      <PageHeader
        title="Réputations"
        description="Votre standing et vos niveaux de carrière auprès de chaque faction."
        actions={mutation.isPending ? <Spinner /> : undefined}
      />

      {mutation.isError ? (
        <Card className="mb-4 border-red-400/30 bg-red-500/10 p-3">
          <p className="text-xs text-red-200">
            {mutation.error instanceof Error
              ? mutation.error.message
              : "La mise à jour a échoué."}
          </p>
        </Card>
      ) : null}

      {factions.length === 0 ? (
        <EmptyState title="Aucune faction configurée" />
      ) : (
        <>
          <Toolbar>
            <SearchField
              label="Rechercher une faction ou une carrière"
              placeholder="Faction ou carrière…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Segmented
              label="Progression"
              value={progress}
              onChange={setProgress}
              options={[
                { value: "all", label: "Toutes" },
                { value: "started", label: "Commencées" },
              ]}
            />
            <span className="ml-auto text-xs text-nexus-dim">
              {count} faction{count > 1 ? "s" : ""}
            </span>
          </Toolbar>

          {count === 0 ? (
            <EmptyState
              title="Aucune faction ne correspond"
              description={
                progress === "started"
                  ? "Élargissez la recherche ou affichez toutes les factions."
                  : "Essayez un autre nom de faction ou de carrière."
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
              {visibleFactions.map((faction) => (
                <FactionRepCard
                  key={faction.name}
                  faction={faction}
                  reputations={reputations}
                  disabled={mutation.isPending}
                  onChange={(update) => mutation.mutate(update)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
