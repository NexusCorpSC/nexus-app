import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  createInventoryItem,
  deleteInventoryItem,
  listInventoryItems,
  listLocations,
  updateInventoryItem,
} from "@/lib/api/inventory";
import { useDebounced } from "@/hooks/use-debounced";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  SearchField,
  Select,
  Toolbar,
  ToolbarSelect,
  ViewToggle,
} from "@/components/ui";
import {
  DeleteIconButton,
  INVENTORY_SORT_OPTIONS,
  InventoryGrid,
  InventoryList,
  OrgVisibleCheckbox,
  groupByLocation,
  locationKey,
  sortInventoryItems,
  useStoredViewMode,
  type InventorySort,
} from "@/components/inventory/inventory-items";
import type { InventoryItem, InventoryItemInput } from "@/types/nexus";

export default function InventoryPage() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [sort, setSort] = useState<InventorySort>("updated");
  const [view, setView] = useStoredViewMode("nexus.inventory.view");
  const [showForm, setShowForm] = useState(false);

  const query = useDebounced(search);

  const locationsQuery = useQuery({
    queryKey: ["locations"],
    queryFn: () => listLocations(),
    staleTime: 10 * 60_000,
  });

  // Every location is fetched at once so the chips can show their counts;
  // the location filter is applied here rather than by the API.
  const itemsQuery = useQuery({
    queryKey: ["inventory-items", query],
    queryFn: () => listInventoryItems({ query: query || undefined }),
  });

  const locationGroups = useMemo(
    () => groupByLocation(itemsQuery.data ?? []),
    [itemsQuery.data],
  );

  const visibleItems = useMemo(() => {
    const items = (itemsQuery.data ?? []).filter(
      (item) => !locationFilter || locationKey(item) === locationFilter,
    );
    return sortInventoryItems(items, sort);
  }, [itemsQuery.data, locationFilter, sort]);

  function invalidateItems() {
    return queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
  }

  const createMutation = useMutation({
    mutationFn: createInventoryItem,
    onSuccess: async () => {
      setShowForm(false);
      await invalidateItems();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteInventoryItem,
    onSuccess: invalidateItems,
  });

  const toggleVisibilityMutation = useMutation({
    mutationFn: ({ id, orgVisible }: { id: string; orgVisible: boolean }) =>
      updateInventoryItem(id, { orgVisible }),
    onSuccess: invalidateItems,
  });

  const mutationError =
    createMutation.error ?? deleteMutation.error ?? toggleVisibilityMutation.error;

  function renderOrgToggle(item: InventoryItem, compact = false) {
    return (
      <OrgVisibleCheckbox
        compact={compact}
        checked={item.orgVisible}
        disabled={toggleVisibilityMutation.isPending}
        onChange={(orgVisible) =>
          toggleVisibilityMutation.mutate({ id: item.id, orgVisible })
        }
      />
    );
  }

  function renderDelete(item: InventoryItem) {
    return (
      <DeleteIconButton
        itemName={item.name}
        disabled={deleteMutation.isPending}
        onClick={() => deleteMutation.mutate(item.id)}
      />
    );
  }

  const totalCount = itemsQuery.data?.length ?? 0;

  return (
    <>
      <PageHeader
        title="Inventaire"
        description="Vos ressources, par lieu de stockage."
        actions={
          <Button onClick={() => setShowForm((open) => !open)}>
            <Plus className="size-4" />
            Ajouter
          </Button>
        }
      />

      {mutationError ? (
        <Card className="mb-4 border-red-400/30 bg-red-500/10 p-3">
          <p className="text-xs text-red-200">
            {mutationError instanceof Error
              ? mutationError.message
              : "L'opération a échoué."}
          </p>
        </Card>
      ) : null}

      {showForm ? (
        <NewItemForm
          locations={locationsQuery.data ?? []}
          pending={createMutation.isPending}
          onCancel={() => setShowForm(false)}
          onSubmit={(input) => createMutation.mutate(input)}
        />
      ) : null}

      <Toolbar className="mb-3">
        <SearchField
          label="Rechercher une ressource"
          value={search}
          placeholder="Nom de la ressource…"
          onChange={(event) => setSearch(event.target.value)}
        />
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

      {totalCount > 0 ? (
        <div
          role="group"
          aria-label="Filtrer par lieu"
          className="mb-6 flex flex-wrap gap-2"
        >
          <Chip
            active={locationFilter === ""}
            onClick={() => setLocationFilter("")}
          >
            Tous · {totalCount}
          </Chip>
          {locationGroups.map((group) => (
            <Chip
              key={group.key}
              active={locationFilter === group.key}
              onClick={() => setLocationFilter(group.key)}
            >
              {group.name} · {group.items.length}
            </Chip>
          ))}
        </div>
      ) : null}

      {itemsQuery.isPending ? (
        <LoadingState />
      ) : itemsQuery.isError ? (
        <ErrorState
          error={itemsQuery.error}
          onRetry={() => void itemsQuery.refetch()}
        />
      ) : visibleItems.length === 0 ? (
        query || locationFilter ? (
          <EmptyState
            title="Aucune ressource trouvée"
            description="Essayez un autre nom ou un autre lieu."
          />
        ) : (
          <EmptyState
            title="Inventaire vide"
            description="Ajoutez une première ressource pour la retrouver depuis le bureau."
          />
        )
      ) : view === "grid" ? (
        <InventoryGrid
          items={visibleItems}
          renderFooter={(item) => (
            <>
              {renderOrgToggle(item)}
              {renderDelete(item)}
            </>
          )}
        />
      ) : (
        <InventoryList
          items={visibleItems}
          renderActions={(item) => (
            <>
              {renderOrgToggle(item, true)}
              {renderDelete(item)}
            </>
          )}
        />
      )}
    </>
  );
}

function NewItemForm({
  locations,
  pending,
  onCancel,
  onSubmit,
}: {
  locations: { id: string; name: string }[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (input: InventoryItemInput) => void;
}) {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("");
  const [quality, setQuality] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [orgVisible, setOrgVisible] = useState(false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !locationId) return;

    onSubmit({
      name: name.trim(),
      quantity: Number(quantity) || 0,
      unit: unit.trim() || undefined,
      quality: quality ? Number(quality) : undefined,
      locationId,
      orgVisible,
    });
  }

  return (
    <Card className="mb-6 p-5">
      <h2 className="mb-4 text-sm font-semibold text-nexus-bright">
        Nouvelle ressource
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Nom" className="sm:col-span-2">
            <Input
              value={name}
              required
              placeholder="Titanium…"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Quantité">
            <Input
              type="number"
              min="0"
              step="any"
              value={quantity}
              required
              onChange={(event) => setQuantity(event.target.value)}
            />
          </Field>
          <Field label="Unité">
            <Input
              value={unit}
              placeholder="SCU"
              onChange={(event) => setUnit(event.target.value)}
            />
          </Field>
          <Field label="Qualité">
            <Input
              type="number"
              min="0"
              value={quality}
              placeholder="—"
              onChange={(event) => setQuality(event.target.value)}
            />
          </Field>
          <Field label="Lieu" className="sm:col-span-2">
            <Select
              value={locationId}
              required
              onChange={(event) => setLocationId(event.target.value)}
            >
              <option value="">Choisir un lieu…</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm text-nexus-accent/75">
            <input
              type="checkbox"
              checked={orgVisible}
              onChange={(event) => setOrgVisible(event.target.checked)}
              className="h-4 w-4 rounded border-nexus-accent/30 bg-nexus-abyss accent-nexus-accent"
            />
            Visible par l'organisation
          </label>
        </div>

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Enregistrement…" : "Enregistrer"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Annuler
          </Button>
        </div>
      </form>
    </Card>
  );
}
