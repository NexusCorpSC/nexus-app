import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { BackLink } from "@/components/layout/back-link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { User } from "lucide-react";
import { useTranslations } from "use-intl";
import { listOrgInventory } from "@/lib/api/orgs";
import { useDebounced } from "@/hooks/use-debounced";
import {
  oneOf,
  useInitialParams,
  useUrlFilters,
} from "@/hooks/use-url-filters";
import {
  Chip,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SearchField,
  Toolbar,
  ToolbarSelect,
} from "@/components/ui";
import {
  INVENTORY_SORT_OPTIONS,
  InventoryGrid,
  QualityFilter,
  parseMinQuality,
  groupInventory,
  type InventorySort,
} from "@/components/inventory/inventory-items";

/**
 * The same cards as the personal inventory — by place, one per resource, a
 * lot per quality — read-only, each lot saying whose it is.
 */
export default function OrgInventoryPage() {
  const t = useTranslations("OrgInventory");
  const tInventory = useTranslations("Inventory");
  const { orgId = "" } = useParams();

  const params = useInitialParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [minQuality, setMinQuality] = useState(params.get("quality") ?? "");
  const [memberId, setMemberId] = useState(params.get("member") ?? "");
  const [locationFilter, setLocationFilter] = useState(
    params.get("location") ?? "",
  );
  const [sort, setSort] = useState<InventorySort>(() =>
    oneOf(
      params,
      "sort",
      INVENTORY_SORT_OPTIONS.map((option) => option.value),
      "updated",
    ),
  );

  const query = useDebounced(search);
  const quality = useDebounced(minQuality);
  useUrlFilters({
    q: query,
    quality,
    member: memberId,
    location: locationFilter,
    sort: sort === "updated" ? null : sort,
  });

  const inventoryQuery = useQuery({
    queryKey: ["org-inventory", orgId, query, quality, memberId],
    queryFn: () =>
      listOrgInventory(orgId, {
        query: query || undefined,
        quality: parseMinQuality(quality),
        userId: memberId || undefined,
      }),
    enabled: Boolean(orgId),
    placeholderData: keepPreviousData,
  });

  const sections = useMemo(
    () => groupInventory(inventoryQuery.data?.items ?? [], sort),
    [inventoryQuery.data, sort],
  );

  // A place the other filters emptied does not hide everything: back to all.
  const activeLocation = sections.some((s) => s.key === locationFilter)
    ? locationFilter
    : "";
  const visibleSections = activeLocation
    ? sections.filter((section) => section.key === activeLocation)
    : sections;

  const totalCount = sections.reduce(
    (sum, section) => sum + section.groups.length,
    0,
  );

  return (
    <>
      <BackLink to={`/orgs/${orgId}`}>{t("back")}</BackLink>

      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      <Toolbar className="mb-3">
        <SearchField
          label={tInventory("searchLabel")}
          value={search}
          placeholder={tInventory("searchPlaceholder")}
          onChange={(event) => setSearch(event.target.value)}
        />
        <ToolbarSelect
          label={t("member")}
          value={memberId}
          onChange={(event) => setMemberId(event.target.value)}
        >
          <option value="">{t("allMembers")}</option>
          {inventoryQuery.data?.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </ToolbarSelect>
        <QualityFilter value={minQuality} onChange={setMinQuality} />
        <ToolbarSelect
          label={tInventory("sortLabel")}
          value={sort}
          onChange={(event) => setSort(event.target.value as InventorySort)}
        >
          {INVENTORY_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {tInventory(`sort.${option.value}`)}
            </option>
          ))}
        </ToolbarSelect>
      </Toolbar>

      {totalCount > 0 ? (
        <div
          role="group"
          aria-label={tInventory("filterByLocation")}
          className="mb-6 flex flex-wrap gap-2"
        >
          <Chip
            active={activeLocation === ""}
            onClick={() => setLocationFilter("")}
          >
            {tInventory("filterAll", { count: totalCount })}
          </Chip>
          {sections.map((section) => (
            <Chip
              key={section.key}
              active={activeLocation === section.key}
              onClick={() => setLocationFilter(section.key)}
            >
              {section.name} · {section.groups.length}
            </Chip>
          ))}
        </div>
      ) : null}

      {inventoryQuery.isPending ? (
        <LoadingState />
      ) : inventoryQuery.isError ? (
        <ErrorState
          error={inventoryQuery.error}
          onRetry={() => void inventoryQuery.refetch()}
        />
      ) : visibleSections.length === 0 ? (
        query || quality || memberId ? (
          <EmptyState
            title={t("noResultsTitle")}
            description={t("noResultsDescription")}
          />
        ) : (
          <EmptyState
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        )
      ) : (
        <InventoryGrid
          sections={visibleSections}
          renderLotMeta={(lot) => (
            <span
              className="flex min-w-0 items-center gap-1 text-xs text-nexus-muted"
              title={t("owner")}
            >
              <User className="size-3.5 shrink-0 text-nexus-dim" />
              <span className="truncate">{lot.ownerName}</span>
            </span>
          )}
        />
      )}
    </>
  );
}
