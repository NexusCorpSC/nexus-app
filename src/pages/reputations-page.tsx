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
  Chip,
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
  FactionRepModal,
} from "@/components/reputations/faction-rep-card";
import {
  CAREER_FAMILIES,
  factionFamily,
  fold,
  isMaxed,
  isStarted,
  matchesSearch,
  type CareerFamily,
} from "@/lib/reputations";
import type { FactionCareer, FactionLevel, RepFaction } from "@/types/nexus";

type Progress = "all" | "started" | "todo";

const FAMILY_LABELS: Record<CareerFamily, string> = {
  guild: "Guildes",
  hauling: "Transport",
  faction: "Contrats de faction",
  trade: "Commerce",
};

const GROUP_LABELS: Record<CareerFamily, string> = {
  guild: "Guildes et métiers",
  hauling: "Transport",
  faction: "Contrats de faction",
  trade: "Commerce",
};

export default function ReputationsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [progress, setProgress] = useState<Progress>("all");
  const [family, setFamily] = useState<CareerFamily | "all">("all");
  const [openName, setOpenName] = useState<string | null>(null);

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

  // A faction gone from the game only stays for players who followed it.
  const listed = useMemo(() => {
    const reputations = reputationsQuery.data ?? {};
    return (factionsQuery.data ?? []).filter(
      (faction) => !faction.removedInVersion || isStarted(faction, reputations),
    );
  }, [factionsQuery.data, reputationsQuery.data]);

  // The faction list is small and already loaded, so filtering stays
  // client-side: instant, and no endpoint needs a search parameter.
  const visibleFactions = useMemo(() => {
    const reputations = reputationsQuery.data ?? {};
    const needle = fold(search.trim());
    return listed.filter(
      (faction) =>
        matchesSearch(faction, needle) &&
        (family === "all" || factionFamily(faction) === family) &&
        (progress === "all" ||
          (progress === "started") === isStarted(faction, reputations)),
    );
  }, [listed, reputationsQuery.data, search, family, progress]);

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

  const reputations = reputationsQuery.data;
  const count = visibleFactions.length;
  const startedCount = listed.filter((f) => isStarted(f, reputations)).length;
  const maxedCount = listed.filter((f) => isMaxed(f, reputations)).length;
  const presentFamilies = CAREER_FAMILIES.filter((key) =>
    listed.some((faction) => factionFamily(faction) === key),
  );
  const groups = CAREER_FAMILIES.map((key) => ({
    key,
    factions: visibleFactions.filter((f) => factionFamily(f) === key),
  })).filter((group) => group.factions.length > 0);
  const openFaction = listed.find((faction) => faction.name === openName);

  const changeLevel = (
    faction: RepFaction,
    career: FactionCareer,
    level: FactionLevel,
  ) =>
    mutation.mutate({
      factionName: faction.name,
      careerName: career.name,
      levelName: level.name,
    });

  return (
    <>
      <PageHeader
        title="Réputations"
        description={`Votre rang auprès de chaque faction, tel qu'il s'affiche dans le mobiGlas. ${startedCount} faction${startedCount > 1 ? "s" : ""} suivie${startedCount > 1 ? "s" : ""} sur ${listed.length}, ${maxedCount} au rang max.`}
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

      {listed.length === 0 ? (
        <EmptyState title="Aucune faction configurée" />
      ) : (
        <>
          <Toolbar>
            <SearchField
              label="Rechercher une faction, une carrière ou un rang"
              placeholder="Faction, carrière ou rang…"
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
                { value: "todo", label: "À commencer" },
              ]}
            />
            {presentFamilies.length > 1 ? (
              <div
                role="group"
                aria-label="Type de carrière"
                className="flex flex-wrap gap-1.5"
              >
                <Chip
                  active={family === "all"}
                  onClick={() => setFamily("all")}
                >
                  Toutes
                </Chip>
                {presentFamilies.map((key) => (
                  <Chip
                    key={key}
                    active={family === key}
                    onClick={() => setFamily(key)}
                  >
                    {FAMILY_LABELS[key]}
                  </Chip>
                ))}
              </div>
            ) : null}
            <span className="ml-auto text-xs text-nexus-dim">
              {count} faction{count > 1 ? "s" : ""}
            </span>
          </Toolbar>

          {count === 0 ? (
            <EmptyState
              title="Aucune faction ne correspond"
              description="Essayez un autre nom, ou affichez toutes les factions."
            />
          ) : (
            <div className="flex flex-col gap-6">
              {groups.map((group) => (
                <section key={group.key} className="flex flex-col gap-3">
                  <h2 className="flex items-baseline gap-2.5 font-display text-[12px] font-semibold uppercase tracking-[0.12em] text-nexus-dim">
                    {GROUP_LABELS[group.key]}
                    <span className="font-mono tracking-normal">
                      {group.factions.length}
                    </span>
                  </h2>
                  <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
                    {group.factions.map((faction) => (
                      <FactionRepCard
                        key={faction.name}
                        faction={faction}
                        reputations={reputations}
                        disabled={mutation.isPending}
                        onOpen={() => setOpenName(faction.name)}
                        onLevel={(career, level) =>
                          changeLevel(faction, career, level)
                        }
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          <FactionRepModal
            faction={openFaction}
            reputations={reputations}
            disabled={mutation.isPending}
            onClose={() => setOpenName(null)}
            onLevel={(career, level) =>
              openFaction && changeLevel(openFaction, career, level)
            }
            onStanding={(standing) =>
              openFaction &&
              mutation.mutate({ factionName: openFaction.name, standing })
            }
          />
        </>
      )}
    </>
  );
}
