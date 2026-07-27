import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  listBlueprintCategories,
  listBlueprints,
} from "@/lib/api/blueprints";
import { useDebounced } from "@/hooks/use-debounced";
import { useAuth } from "@/auth/auth-context";
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
import { formatDuration } from "@/lib/utils";

export default function BlueprintsPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [owned, setOwned] = useState<"" | "true" | "false">("");
  const [page, setPage] = useState(1);

  const query = useDebounced(search);

  const categoriesQuery = useQuery({
    queryKey: ["blueprint-categories"],
    queryFn: listBlueprintCategories,
    staleTime: 30 * 60_000,
  });

  const subcategories = useMemo(
    () =>
      categoriesQuery.data?.find((c) => c.category === category)
        ?.subcategories ?? [],
    [categoriesQuery.data, category],
  );

  const blueprintsQuery = useQuery({
    queryKey: ["blueprints", query, category, subcategory, owned, page],
    queryFn: () =>
      listBlueprints({
        query: query || undefined,
        category: category || undefined,
        subcategory: subcategory || undefined,
        owned: owned === "" ? undefined : owned === "true",
        page,
      }),
    placeholderData: keepPreviousData,
  });

  /** Resets pagination whenever the result set changes shape. */
  function updateFilter(apply: () => void) {
    apply();
    setPage(1);
  }

  return (
    <>
      <PageHeader
        title="Blueprints"
        description="Recherchez les plans de fabrication, leurs recettes et leurs statistiques."
      />

      <Card className="mb-6 p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Recherche" className="sm:col-span-2 lg:col-span-1">
            <Input
              value={search}
              placeholder="Nom du blueprint…"
              onChange={(event) =>
                updateFilter(() => setSearch(event.target.value))
              }
            />
          </Field>

          <Field label="Catégorie">
            <Select
              value={category}
              onChange={(event) =>
                updateFilter(() => {
                  setCategory(event.target.value);
                  setSubcategory("");
                })
              }
            >
              <option value="">Toutes</option>
              {categoriesQuery.data?.map((c) => (
                <option key={c.category} value={c.category}>
                  {c.category}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Sous-catégorie">
            <Select
              value={subcategory}
              disabled={!subcategories.length}
              onChange={(event) =>
                updateFilter(() => setSubcategory(event.target.value))
              }
            >
              <option value="">Toutes</option>
              {subcategories.map((sub) => (
                <option key={sub} value={sub}>
                  {sub}
                </option>
              ))}
            </Select>
          </Field>

          {/* The `owned` filter is resolved server-side from the session. */}
          {user ? (
            <Field label="Possession">
              <Select
                value={owned}
                onChange={(event) =>
                  updateFilter(() =>
                    setOwned(event.target.value as "" | "true" | "false"),
                  )
                }
              >
                <option value="">Tous</option>
                <option value="true">Possédés</option>
                <option value="false">Non possédés</option>
              </Select>
            </Field>
          ) : null}
        </div>
      </Card>

      {blueprintsQuery.isPending ? (
        <LoadingState />
      ) : blueprintsQuery.isError ? (
        <ErrorState
          error={blueprintsQuery.error}
          onRetry={() => void blueprintsQuery.refetch()}
        />
      ) : blueprintsQuery.data.blueprints.length === 0 ? (
        <EmptyState
          title="Aucun blueprint trouvé"
          description="Essayez un autre terme de recherche ou élargissez les filtres."
        />
      ) : (
        <>
          <p className="mb-3 text-xs text-nexus-accent/50">
            {blueprintsQuery.data.total} résultat
            {blueprintsQuery.data.total > 1 ? "s" : ""}
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {blueprintsQuery.data.blueprints.map((blueprint) => (
              <Link key={blueprint.id} to={`/blueprints/${blueprint.slug}`}>
                <Card className="h-full p-4 transition-colors hover:border-nexus-accent/40">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-nexus-bright">
                      {blueprint.name}
                    </p>
                    {blueprint.owned ? (
                      <Badge tone="success">Possédé</Badge>
                    ) : null}
                  </div>

                  <p className="mt-1 text-xs text-nexus-accent/50">
                    {blueprint.category}
                    {blueprint.subcategory ? ` · ${blueprint.subcategory}` : ""}
                  </p>

                  {blueprint.description ? (
                    <p className="mt-2 line-clamp-2 text-xs text-nexus-accent/70">
                      {blueprint.description}
                    </p>
                  ) : null}

                  {blueprint.craftingTime ? (
                    <p className="mt-3 text-[11px] text-nexus-accent/45">
                      Fabrication : {formatDuration(blueprint.craftingTime)}
                    </p>
                  ) : null}
                </Card>
              </Link>
            ))}
          </div>

          <Pagination
            page={blueprintsQuery.data.page}
            totalPages={blueprintsQuery.data.totalPages}
            onPageChange={setPage}
          />
        </>
      )}
    </>
  );
}
