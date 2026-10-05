import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "use-intl";
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
import {
  oneOf,
  useInitialParams,
  useUrlFilters,
} from "@/hooks/use-url-filters";

type Progress = "all" | "started" | "todo";

export default function ReputationsPage() {
  const t = useTranslations("Reputations");
  const queryClient = useQueryClient();
  const params = useInitialParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [progress, setProgress] = useState<Progress>(() =>
    oneOf(params, "progress", ["all", "started", "todo"], "all"),
  );
  const [family, setFamily] = useState<CareerFamily | "all">(() =>
    oneOf<CareerFamily | "all">(params, "family", CAREER_FAMILIES, "all"),
  );
  useUrlFilters({
    q: search,
    progress: progress === "all" ? null : progress,
    family: family === "all" ? null : family,
  });
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
        title={t("title")}
        description={t("description", {
          started: startedCount,
          total: listed.length,
          maxed: maxedCount,
        })}
        actions={mutation.isPending ? <Spinner /> : undefined}
      />

      {mutation.isError ? (
        <Card className="mb-4 border-red-400/30 bg-red-500/10 p-3">
          <p className="text-xs text-red-200">
            {mutation.error instanceof Error
              ? mutation.error.message
              : t("updateFailed")}
          </p>
        </Card>
      ) : null}

      {listed.length === 0 ? (
        <EmptyState title={t("noFactions")} />
      ) : (
        <>
          <Toolbar>
            <SearchField
              label={t("searchLabel")}
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Segmented
              label={t("progressLabel")}
              value={progress}
              onChange={setProgress}
              options={[
                { value: "all", label: t("progress.all") },
                { value: "started", label: t("progress.started") },
                { value: "todo", label: t("progress.todo") },
              ]}
            />
            {presentFamilies.length > 1 ? (
              <div
                role="group"
                aria-label={t("familyLabel")}
                className="flex flex-wrap gap-1.5"
              >
                <Chip
                  active={family === "all"}
                  onClick={() => setFamily("all")}
                >
                  {t("allFamilies")}
                </Chip>
                {presentFamilies.map((key) => (
                  <Chip
                    key={key}
                    active={family === key}
                    onClick={() => setFamily(key)}
                  >
                    {t(`family.${key}`)}
                  </Chip>
                ))}
              </div>
            ) : null}
            <span className="ml-auto text-xs text-nexus-dim">
              {t("count", { count })}
            </span>
          </Toolbar>

          {count === 0 ? (
            <EmptyState
              title={t("noMatchTitle")}
              description={t("noMatchHint")}
            />
          ) : (
            <div className="flex flex-col gap-6">
              {groups.map((group) => (
                <section key={group.key} className="flex flex-col gap-3">
                  <h2 className="flex items-baseline gap-2.5 font-display text-[12px] font-semibold uppercase tracking-[0.12em] text-nexus-dim">
                    {t(`group.${group.key}`)}
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
