import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listBlueprintCategories, listBlueprints } from "@/lib/api/blueprints";
import { useDebounced } from "@/hooks/use-debounced";
import { useAuth } from "@/auth/auth-context";
import { BlueprintQuickAdd } from "@/components/blueprint-add-button";
import type { Blueprint } from "@/types/nexus";
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
import { cn, formatDuration } from "@/lib/utils";

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

  /** Nothing to add when signed out, or when the blueprint is already owned. */
  function canAdd(blueprint: Blueprint): boolean {
    return Boolean(user) && !blueprint.owned;
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
              /* The quick add sits beside the link rather than inside it: a
                 button nested in a link would open the blueprint on its way
                 through. It only shows when there is something to add, where
                 the «Possédé» badge would otherwise be. */
              <div key={blueprint.id} className="relative h-full">
                <Link
                  to={`/blueprints/${blueprint.slug}`}
                  className="block h-full"
                >
                  <Card className="h-full p-4 transition-colors hover:border-nexus-accent/40">
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={cn(
                          "font-medium text-nexus-bright",
                          canAdd(blueprint) ? "pr-8" : null,
                        )}
                      >
                        {blueprint.name}
                      </p>
                      {blueprint.owned ? (
                        <Badge tone="success">Possédé</Badge>
                      ) : null}
                    </div>

                    <p className="mt-1 text-xs text-nexus-accent/50">
                      {blueprint.category}
                      {blueprint.subcategory
                        ? ` · ${blueprint.subcategory}`
                        : ""}
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

                {canAdd(blueprint) ? (
                  <BlueprintQuickAdd
                    blueprintId={blueprint.id}
                    className="absolute right-2.5 top-2.5"
                  />
                ) : null}
              </div>
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
