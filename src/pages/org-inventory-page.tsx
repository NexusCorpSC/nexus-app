import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, User } from "lucide-react";
import { listOrgInventory } from "@/lib/api/orgs";
import { useDebounced } from "@/hooks/use-debounced";
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
  groupInventory,
  type InventorySort,
} from "@/components/inventory/inventory-items";

/**
 * The same cards as the personal inventory — by place, one per resource, a
 * lot per quality — read-only, each lot saying whose it is.
 */
export default function OrgInventoryPage() {
  const { orgId = "" } = useParams();

  const [search, setSearch] = useState("");
  const [minQuality, setMinQuality] = useState("");
  const [memberId, setMemberId] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [sort, setSort] = useState<InventorySort>("updated");

  const query = useDebounced(search);
  const quality = useDebounced(minQuality);

  const inventoryQuery = useQuery({
    queryKey: ["org-inventory", orgId, query, quality, memberId],
    queryFn: () =>
      listOrgInventory(orgId, {
        query: query || undefined,
        quality: quality ? Number(quality) : undefined,
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
      <Link
        to="/orgs"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-nexus-muted transition-colors hover:text-nexus-accent"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Retour aux organisations
      </Link>

      <PageHeader
        title="Inventaire partagé"
        description="Ressources rendues visibles par les membres de l'organisation."
      />

      <Toolbar className="mb-3">
        <SearchField
          label="Rechercher une ressource"
          value={search}
          placeholder="Nom de la ressource…"
          onChange={(event) => setSearch(event.target.value)}
        />
        <ToolbarSelect
          label="Membre"
          value={memberId}
          onChange={(event) => setMemberId(event.target.value)}
        >
          <option value="">Tous</option>
          {inventoryQuery.data?.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </ToolbarSelect>
        <QualityFilter value={minQuality} onChange={setMinQuality} />
        <ToolbarSelect
          label="Tri"
          value={sort}
          onChange={(event) => setSort(event.target.value as InventorySort)}
        >
          {INVENTORY_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </ToolbarSelect>
      </Toolbar>

      {totalCount > 0 ? (
        <div
          role="group"
          aria-label="Filtrer par lieu"
          className="mb-6 flex flex-wrap gap-2"
        >
          <Chip
            active={activeLocation === ""}
            onClick={() => setLocationFilter("")}
          >
            Tous · {totalCount}
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
            title="Aucune ressource trouvée"
            description="Essayez un autre nom, un autre membre, une autre qualité ou un autre lieu."
          />
        ) : (
          <EmptyState
            title="Aucune ressource partagée"
            description="Les membres doivent cocher « Visible par l'org » sur leurs ressources pour qu'elles apparaissent ici."
          />
        )
      ) : (
        <InventoryGrid
          sections={visibleSections}
          renderLotMeta={(lot) => (
            <span
              className="flex min-w-0 items-center gap-1 text-xs text-nexus-muted"
              title="Propriétaire"
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
