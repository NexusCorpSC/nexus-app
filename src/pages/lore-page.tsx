import { useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "use-intl";
import { browseLore, listStarSystems } from "@/lib/api/lore";
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
  SectionTitle,
  Toolbar,
  ToolbarSelect,
} from "@/components/ui";
import { LoreArticleCard, systemPath } from "@/components/lore/lore-parts";
import { cn } from "@/lib/utils";

/**
 * La Galactapedia et la starmap de RSI, comme `/lore` sur le site : la
 * recherche (en anglais, par pertinence) et la liste des systèmes.
 */
export default function LorePage() {
  const t = useTranslations("Lore");
  const params = useInitialParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [category, setCategory] = useState(params.get("category") ?? "");
  const [page, setPage] = useState(() => pageFrom(params));
  const query = useDebounced(search);
  useUrlFilters({ q: query, category, page });

  const loreQuery = useQuery({
    queryKey: ["lore", query, category, page],
    queryFn: () =>
      browseLore({
        query: query || undefined,
        category: category || undefined,
        page,
      }),
    placeholderData: keepPreviousData,
  });
  const browsing = !query && !category;
  const systemsQuery = useQuery({
    queryKey: ["lore-systems"],
    queryFn: listStarSystems,
    staleTime: 30 * 60_000,
    enabled: browsing,
  });

  const data = loreQuery.data;
  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1;

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <p className="-mt-4 mb-4 text-xs text-nexus-dim">{t("englishNote")}</p>

      <Toolbar>
        <SearchField
          label={t("searchLabel")}
          value={search}
          placeholder={t("searchPlaceholder")}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <ToolbarSelect
          label={t("category")}
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setPage(1);
          }}
        >
          <option value="">{t("allCategories")}</option>
          {(data?.categories ?? []).map((entry) => (
            <option key={entry.name} value={entry.name}>
              {entry.name} ({entry.count})
            </option>
          ))}
        </ToolbarSelect>
      </Toolbar>

      {loreQuery.isPending ? (
        <LoadingState />
      ) : loreQuery.isError ? (
        <ErrorState
          error={loreQuery.error}
          onRetry={() => void loreQuery.refetch()}
        />
      ) : data && data.results.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : data ? (
        <>
          <p className="mb-3 text-xs text-nexus-dim">
            {t("results", { count: data.total })}
          </p>
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {data.results.map((article) => (
              <LoreArticleCard key={article.id} article={article} />
            ))}
          </div>
          <Pagination
            page={data.page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </>
      ) : null}

      {browsing && systemsQuery.data && systemsQuery.data.length > 0 ? (
        <section className="mt-6">
          <SectionTitle aside={systemsQuery.data.length}>
            {t("systemsTitle")}
          </SectionTitle>
          <div className="flex flex-wrap gap-2">
            {systemsQuery.data.map((system) => (
              <Link
                key={system.code}
                to={systemPath(system.code)}
                title={[
                  system.affiliations.join("/"),
                  t(
                    system.status === "P"
                      ? "statusP"
                      : system.status === "M"
                        ? "statusM"
                        : "statusN",
                  ),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-[13px] transition-colors hover:border-nexus-accent/40",
                  system.status === "P"
                    ? "border-nexus-accent/20 bg-nexus-card text-nexus-white"
                    : "border-dashed border-nexus-accent/15 text-nexus-dim",
                )}
              >
                {system.name}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <p className="mt-6 text-[11px] text-nexus-dim">{t("source")}</p>
    </>
  );
}
