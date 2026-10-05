import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { listFactionBlueprints } from "@/lib/api/factions";
import { useDebounced } from "@/hooks/use-debounced";
import { useInitialParams, useUrlFilters } from "@/hooks/use-url-filters";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SearchField,
  Toolbar,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import type { FactionWithBlueprints } from "@/types/nexus";

/**
 * Which faction rewards which blueprints.
 *
 * The route hands back every faction at once, so the search below filters what
 * is already here — on faction names *and* blueprint names, since «where do I
 * get this thing» is the question this screen exists for.
 */
export default function FactionsPage() {
  // The search palette links here with a faction id when it finds one.
  const { factionId } = useParams();
  const params = useInitialParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const query = useDebounced(search);
  useUrlFilters({ q: query });

  const factionsQuery = useQuery({
    queryKey: ["factions"],
    queryFn: listFactionBlueprints,
  });

  const factions = useMemo(
    () => filterFactions(factionsQuery.data ?? [], query),
    [factionsQuery.data, query],
  );

  if (factionsQuery.isPending) return <LoadingState />;

  if (factionsQuery.isError) {
    return (
      <ErrorState
        error={factionsQuery.error}
        onRetry={() => void factionsQuery.refetch()}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Factions"
        description="Les blueprints récompensés par les missions de chaque faction."
      />

      <Toolbar>
        <SearchField
          label="Rechercher une faction ou un blueprint"
          value={search}
          placeholder="Nom de faction ou de blueprint…"
          onChange={(event) => setSearch(event.target.value)}
        />
      </Toolbar>

      {factions.length === 0 ? (
        <EmptyState
          title="Aucune faction trouvée"
          description="Aucune faction ne porte ce nom, et aucun de leurs blueprints non plus."
        />
      ) : (
        <div className="space-y-4">
          {factions.map((faction) => (
            <FactionCard
              key={faction._id}
              faction={faction}
              highlighted={faction._id === factionId}
            />
          ))}
        </div>
      )}
    </>
  );
}

function FactionCard({
  faction,
  highlighted,
}: {
  faction: FactionWithBlueprints;
  highlighted: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Arrived from the palette: the faction asked for may be far down the list.
  useEffect(() => {
    if (highlighted) {
      cardRef.current?.scrollIntoView({ block: "center" });
    }
  }, [highlighted]);

  return (
    <div ref={cardRef}>
      <Card
        className={cn(
          "p-5",
          highlighted ? "border-nexus-accent/50 ring-1 ring-nexus-accent/30" : "",
        )}
      >
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-nexus-white">
            {faction.name}
          </h2>
          <span className="text-xs text-nexus-dim">
            {faction.blueprints.length} blueprint
            {faction.blueprints.length > 1 ? "s" : ""}
          </span>
        </div>

        <ul className="grid gap-1.5 sm:grid-cols-2">
          {faction.blueprints.map((blueprint) => (
            <li key={blueprint._id}>
              <Link
                to={`/blueprints/${blueprint.slug}`}
                className="group flex items-center gap-2 rounded-lg border border-nexus-accent/8 bg-[#08243a] px-3 py-2 transition-colors hover:border-nexus-accent/35"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-nexus-white">
                    {blueprint.name}
                  </p>
                  {blueprint.category ? (
                    <p className="truncate text-xs text-nexus-dim">
                      {[blueprint.category, blueprint.subcategory]
                        .filter(Boolean)
                        .join(" › ")}
                    </p>
                  ) : null}
                </div>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-nexus-dim/60 transition-colors group-hover:text-nexus-accent" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/**
 * Keeps a faction whose name matches, with all its blueprints; otherwise keeps
 * only the blueprints that match, and drops the faction when none do.
 */
export function filterFactions(
  factions: FactionWithBlueprints[],
  query: string,
): FactionWithBlueprints[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return factions;

  const matched: FactionWithBlueprints[] = [];

  for (const faction of factions) {
    if (faction.name.toLowerCase().includes(needle)) {
      matched.push(faction);
      continue;
    }

    const blueprints = faction.blueprints.filter((blueprint) =>
      blueprint.name.toLowerCase().includes(needle),
    );

    if (blueprints.length > 0) matched.push({ ...faction, blueprints });
  }

  return matched;
}
