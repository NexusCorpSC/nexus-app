import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, User } from "lucide-react";
import { listOrgInventory } from "@/lib/api/orgs";
import { useDebounced } from "@/hooks/use-debounced";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SearchField,
  Toolbar,
  ToolbarSelect,
  ViewToggle,
} from "@/components/ui";
import {
  INVENTORY_SORT_OPTIONS,
  InventoryGrid,
  InventoryList,
  sortInventoryItems,
  useStoredViewMode,
  type InventorySort,
} from "@/components/inventory/inventory-items";

export default function OrgInventoryPage() {
  const { orgId = "" } = useParams();

  const [search, setSearch] = useState("");
  const [memberId, setMemberId] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<InventorySort>("updated");
  const [view, setView] = useStoredViewMode("nexus.org-inventory.view");

  const query = useDebounced(search);

  const inventoryQuery = useQuery({
    queryKey: ["org-inventory", orgId, query, memberId, page],
    queryFn: () =>
      listOrgInventory(orgId, {
        query: query || undefined,
        userId: memberId || undefined,
        page,
      }),
    enabled: Boolean(orgId),
    placeholderData: keepPreviousData,
  });

  // The sort only orders the page on screen: the endpoint has no sort option.
  const items = useMemo(
    () => sortInventoryItems(inventoryQuery.data?.items ?? [], sort),
    [inventoryQuery.data, sort],
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

      <Toolbar className="mb-6">
        <SearchField
          label="Rechercher une ressource"
          value={search}
          placeholder="Nom de la ressource…"
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <ToolbarSelect
          label="Membre"
          value={memberId}
          onChange={(event) => {
            setMemberId(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Tous</option>
          {inventoryQuery.data?.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </ToolbarSelect>
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
        <ViewToggle value={view} onChange={setView} />
      </Toolbar>

      {inventoryQuery.isPending ? (
        <LoadingState />
      ) : inventoryQuery.isError ? (
        <ErrorState
          error={inventoryQuery.error}
          onRetry={() => void inventoryQuery.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="Aucune ressource partagée"
          description="Les membres doivent cocher « Visible par l'org » sur leurs ressources pour qu'elles apparaissent ici."
        />
      ) : (
        <>
          <p className="mb-4 text-xs text-nexus-dim">
            {inventoryQuery.data.total} ressource
            {inventoryQuery.data.total > 1 ? "s" : ""}
          </p>

          {view === "grid" ? (
            <InventoryGrid
              items={items}
              renderFooter={(item) => (
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-nexus-muted">
                  <User className="size-3.5 shrink-0 text-nexus-dim" />
                  <span className="truncate">{item.ownerName}</span>
                </span>
              )}
            />
          ) : (
            <InventoryList
              items={items}
              renderMeta={(item) => (
                <span className="text-nexus-muted">{item.ownerName}</span>
              )}
            />
          )}

          {/* This endpoint reports `hasMore` rather than a page count. */}
          <div className="flex items-center justify-center gap-3 py-6">
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              Précédent
            </Button>
            <span className="text-xs text-nexus-dim">Page {page}</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!inventoryQuery.data.hasMore}
              onClick={() => setPage((current) => current + 1)}
            >
              Suivant
            </Button>
          </div>
        </>
      )}
    </>
  );
}
