import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTranslations } from "use-intl";
import { listBlueprintCategories, listBlueprints } from "@/lib/api/blueprints";
import { useDebounced } from "@/hooks/use-debounced";
import {
  pageFrom,
  useInitialParams,
  useUrlFilters,
} from "@/hooks/use-url-filters";
import { useAuth } from "@/auth/auth-context";
import {
  BlueprintQuickAdd,
  BlueprintQuickRemove,
} from "@/components/blueprint-ownership-buttons";
import type { Blueprint } from "@/types/nexus";
import { DraftingCompass } from "lucide-react";
import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Pagination,
  SearchField,
  Toolbar,
  ToolbarSelect,
} from "@/components/ui";
import { formatDuration } from "@/lib/utils";

/** The quick ownership control, over the corner of a card's picture. */
const QUICK_CONTROL =
  "absolute right-2 top-2 bg-nexus-abyss/70 backdrop-blur-sm";

export default function BlueprintsPage() {
  const t = useTranslations("Blueprints.list");
  const { user } = useAuth();
  const params = useInitialParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [category, setCategory] = useState(params.get("category") ?? "");
  const [subcategory, setSubcategory] = useState(
    params.get("subcategory") ?? "",
  );
  const [owned, setOwned] = useState<"" | "true" | "false">(() => {
    const value = params.get("owned");
    return value === "true" || value === "false" ? value : "";
  });
  const [page, setPage] = useState(() => pageFrom(params));

  const query = useDebounced(search);
  useUrlFilters({ q: query, category, subcategory, owned, page });

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

  /**
   * Only when possession is known to be false. `owned` is absent from a list
   * read without a session, and that list stays on screen through the refetch
   * that signing in triggers — «unknown» must not read as «yours to add», or
   * the button would flash on blueprints already owned.
   */
  function canAdd(blueprint: Blueprint): boolean {
    return Boolean(user) && blueprint.owned === false;
  }

  /**
   * A default blueprint is owned by everyone: it wears the badge like the
   * others, but there is nothing to take back.
   */
  function canRemove(blueprint: Blueprint): boolean {
    return Boolean(user) && blueprint.owned === true && !blueprint.isDefault;
  }

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      <Toolbar className={categoriesQuery.data?.length ? "mb-3" : undefined}>
        <SearchField
          label={t("searchLabel")}
          value={search}
          placeholder={t("searchPlaceholder")}
          onChange={(event) =>
            updateFilter(() => setSearch(event.target.value))
          }
        />

        {subcategories.length ? (
          <ToolbarSelect
            label={t("subcategory")}
            value={subcategory}
            onChange={(event) =>
              updateFilter(() => setSubcategory(event.target.value))
            }
          >
            <option value="">{t("allSubcategories")}</option>
            {subcategories.map((sub) => (
              <option key={sub} value={sub}>
                {sub}
              </option>
            ))}
          </ToolbarSelect>
        ) : null}

        {/* The `owned` filter is resolved server-side from the session. */}
        {user ? (
          <ToolbarSelect
            label={t("ownership")}
            value={owned}
            onChange={(event) =>
              updateFilter(() =>
                setOwned(event.target.value as "" | "true" | "false"),
              )
            }
          >
            <option value="">{t("ownedAll")}</option>
            <option value="true">{t("ownedOwned")}</option>
            <option value="false">{t("ownedNotOwned")}</option>
          </ToolbarSelect>
        ) : null}
      </Toolbar>

      {categoriesQuery.data?.length ? (
        <div className="mb-5 flex flex-wrap gap-2">
          <Chip
            active={category === ""}
            onClick={() =>
              updateFilter(() => {
                setCategory("");
                setSubcategory("");
              })
            }
          >
            {t("allCategories")}
          </Chip>
          {categoriesQuery.data.map((c) => (
            <Chip
              key={c.category}
              active={category === c.category}
              onClick={() =>
                updateFilter(() => {
                  setCategory(c.category);
                  setSubcategory("");
                })
              }
            >
              {c.category}
            </Chip>
          ))}
        </div>
      ) : null}

      {blueprintsQuery.isPending ? (
        <LoadingState />
      ) : blueprintsQuery.isError ? (
        <ErrorState
          error={blueprintsQuery.error}
          onRetry={() => void blueprintsQuery.refetch()}
        />
      ) : blueprintsQuery.data.blueprints.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <>
          <p className="mb-3 text-xs text-nexus-dim">
            {t("results", { count: blueprintsQuery.data.total })}
          </p>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {blueprintsQuery.data.blueprints.map((blueprint) => (
              /* The quick controls sit beside the link rather than inside it:
                 a button nested in a link would open the blueprint on its way
                 through. They take the corner of the picture. */
              <div key={blueprint.id} className="relative h-full">
                <Link
                  to={`/blueprints/${blueprint.slug}`}
                  className="block h-full"
                >
                  <Card className="h-full overflow-hidden transition-colors hover:border-nexus-accent/35">
                    <div className="flex h-26 items-center justify-center bg-[#08243a]">
                      {blueprint.imageUrl ? (
                        <img
                          src={blueprint.imageUrl}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <DraftingCompass className="size-7 text-nexus-accent/25" />
                      )}
                    </div>

                    <div className="p-3.5">
                      <p className="truncate text-[10.5px] font-semibold tracking-wider text-sky-300/80 uppercase">
                        {blueprint.category}
                        {blueprint.subcategory
                          ? ` · ${blueprint.subcategory}`
                          : ""}
                      </p>
                      <p
                        className="mt-1 truncate text-sm font-semibold text-nexus-white"
                        title={blueprint.name}
                      >
                        {blueprint.name}
                      </p>

                      {blueprint.craftingTime || blueprint.owned ? (
                        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-nexus-dim">
                          <span>
                            {blueprint.craftingTime
                              ? formatDuration(blueprint.craftingTime)
                              : null}
                          </span>
                          {blueprint.owned ? (
                            <span className="rounded-full bg-emerald-300/14 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                              {t("owned")}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </Card>
                </Link>

                {canAdd(blueprint) ? (
                  <BlueprintQuickAdd
                    blueprintId={blueprint.id}
                    className={QUICK_CONTROL}
                  />
                ) : canRemove(blueprint) ? (
                  <BlueprintQuickRemove
                    blueprintId={blueprint.id}
                    className={QUICK_CONTROL}
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
