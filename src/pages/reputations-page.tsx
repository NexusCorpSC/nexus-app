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
  Select,
  Spinner,
} from "@/components/ui";
import type { PlayerReputations, RepFaction } from "@/types/nexus";

export default function ReputationsPage() {
  const queryClient = useQueryClient();

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

  return (
    <>
      <PageHeader
        title="Réputations"
        description="Suivez votre standing et vos niveaux de carrière auprès de chaque faction."
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
        <div className="space-y-4">
          {factions.map((faction) => (
            <FactionCard
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
  );
}

function FactionCard({
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
  const playerFaction = reputations[faction.name];
  const standing = playerFaction?.standing ?? faction.defaultStanding;

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-nexus-bright">
          {faction.name}
        </h2>

        <label className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-nexus-accent/50">
            Standing
          </span>
          <Select
            className="w-44"
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
          </Select>
        </label>
      </div>

      {faction.careers.length === 0 ? (
        <p className="text-xs text-nexus-accent/50">
          Aucune carrière pour cette faction.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {faction.careers.map((career) => {
            const currentLevel =
              playerFaction?.careers?.[career.name]?.level ??
              career.levels.find((level) => level.isDefault) ??
              career.levels[0];

            return (
              <label
                key={career.name}
                className="rounded-lg border border-nexus-accent/10 bg-nexus-abyss/40 p-3"
              >
                <span className="mb-1.5 block text-xs font-medium text-nexus-bright/85">
                  {career.name}
                </span>
                <Select
                  value={currentLevel?.name ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({
                      factionName: faction.name,
                      careerName: career.name,
                      levelName: event.target.value,
                    })
                  }
                >
                  {career.levels.map((level) => (
                    <option key={level.name} value={level.name}>
                      {level.name}
                    </option>
                  ))}
                </Select>
              </label>
            );
          })}
        </div>
      )}
    </Card>
  );
}
