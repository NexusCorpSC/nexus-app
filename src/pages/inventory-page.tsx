import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Inbox, Package, Plus, Send, Table2 } from "lucide-react";
import { Link } from "react-router-dom";
import {
  adjustInventoryItem,
  createInventoryItem,
  deleteInventoryItem,
  listInventoryItems,
  listLocations,
  setInventoryItemOrgVisible,
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
} from "@/components/ui";
import {
  AdjustQuantityButton,
  DeleteIconButton,
  INVENTORY_SORT_OPTIONS,
  InventoryGrid,
  OrgVisibleCheckbox,
  QualityFilter,
  parseMinQuality,
  groupInventory,
  type InventorySort,
} from "@/components/inventory/inventory-items";
import {
  PackagePanel,
  ReceiveParcelModal,
  SentParcelModal,
  availableOf,
  type PackageEntry,
} from "@/components/inventory/parcels";
import type { InventoryItem, InventoryItemInput, Parcel } from "@/types/nexus";

const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

export default function InventoryPage() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [minQuality, setMinQuality] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [sort, setSort] = useState<InventorySort>("updated");
  const [showForm, setShowForm] = useState(false);
  const [packageEntries, setPackageEntries] = useState<PackageEntry[]>([]);
  const [sentParcel, setSentParcel] = useState<Parcel | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);

  /** More of a lot in the package, never beyond what is still available. */
  function addToPackage(item: InventoryItem, quantity: number) {
    setPackageEntries((entries) => {
      const existing = entries.find((entry) => entry.item.id === item.id);
      if (!existing) return [...entries, { item, quantity }];
      return entries.map((entry) =>
        entry.item.id === item.id
          ? {
              item,
              quantity: Math.min(entry.quantity + quantity, availableOf(item)),
            }
          : entry,
      );
    });
  }
  const packaged = new Map(
    packageEntries.map((entry) => [entry.item.id, entry.quantity]),
  );

  const query = useDebounced(search);
  const quality = useDebounced(minQuality);

  const locationsQuery = useQuery({
    queryKey: ["locations"],
    queryFn: () => listLocations(),
    staleTime: 10 * 60_000,
  });

  // Every location is fetched at once so the chips can show their counts;
  // the location filter is applied here rather than by the API.
  const itemsQuery = useQuery({
    queryKey: ["inventory-items", query, quality],
    queryFn: () =>
      listInventoryItems({
        query: query || undefined,
        quality: parseMinQuality(quality),
      }),
  });

  const sections = useMemo(
    () => groupInventory(itemsQuery.data ?? [], sort),
    [itemsQuery.data, sort],
  );

  // A place the other filters emptied does not hide everything: back to all.
  const activeLocation = sections.some((s) => s.key === locationFilter)
    ? locationFilter
    : "";
  const visibleSections = activeLocation
    ? sections.filter((section) => section.key === activeLocation)
    : sections;

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

  const adjustMutation = useMutation({
    mutationFn: ({ id, delta }: { id: string; delta: number }) =>
      adjustInventoryItem(id, delta),
    onSuccess: invalidateItems,
  });

  // A card shares or hides all its lots at once, as on the web.
  const toggleVisibilityMutation = useMutation({
    mutationFn: ({ ids, orgVisible }: { ids: string[]; orgVisible: boolean }) =>
      Promise.all(ids.map((id) => setInventoryItemOrgVisible(id, orgVisible))),
    onSettled: invalidateItems,
  });

  const mutationError =
    createMutation.error ??
    deleteMutation.error ??
    adjustMutation.error ??
    toggleVisibilityMutation.error;

  const totalCount = sections.reduce(
    (sum, section) => sum + section.groups.length,
    0,
  );

  return (
    <>
      <PageHeader
        title="Inventaire"
        description="Vos ressources, par lieu de stockage."
        actions={
          <>
            <Button variant="outline" onClick={() => setReceiveOpen(true)}>
              <Download className="size-4" />
              Recevoir un colis
            </Button>
            <Link
              to="/inventory/parcels"
              title="Mes colis"
              aria-label="Mes colis"
              className="inline-flex h-9.5 w-9.5 items-center justify-center rounded-lg text-nexus-accent/80 transition-colors hover:bg-nexus-accent/10 hover:text-nexus-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nexus-accent"
            >
              <Inbox className="size-4.5" />
            </Link>
            <Button
              variant="outline"
              onClick={() => setShowForm((open) => !open)}
            >
              <Plus className="size-4" />
              Ajouter
            </Button>
            <Link
              to="/inventory/quick-add"
              className="inline-flex h-9.5 items-center gap-2 rounded-lg border border-nexus-accent bg-nexus-accent px-4 text-[13px] font-semibold text-nexus-abyss transition-colors hover:bg-nexus-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nexus-accent"
            >
              <Table2 className="size-4" />
              Ajout en masse
            </Link>
          </>
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

      <div className="flex items-start gap-5">
        <div className="min-w-0 flex-1">
          {itemsQuery.isPending ? (
            <LoadingState />
          ) : itemsQuery.isError ? (
            <ErrorState
              error={itemsQuery.error}
              onRetry={() => void itemsQuery.refetch()}
            />
          ) : visibleSections.length === 0 ? (
            query || quality ? (
              <EmptyState
                title="Aucune ressource trouvée"
                description="Essayez un autre nom, une autre qualité ou un autre lieu."
              />
            ) : (
              <EmptyState
                title="Inventaire vide"
                description="Ajoutez une première ressource pour la retrouver depuis le bureau."
              />
            )
          ) : (
            <InventoryGrid
              sections={visibleSections}
              narrow={packageEntries.length > 0}
              renderLotMeta={(lot) => (
                <span className="flex items-center gap-2 pl-2">
                  {lot.reserved !== undefined ? (
                    <span
                      className="flex items-center gap-1 text-xs text-amber-300"
                      title={`${number.format(lot.reserved)} réservés dans un colis en attente`}
                    >
                      <Send className="size-3.5" aria-hidden />
                      <span className="sr-only">
                        {number.format(lot.reserved)} réservés dans un colis en
                        attente
                      </span>
                    </span>
                  ) : null}
                  {packaged.has(lot.id) ? (
                    <span
                      className="flex items-center gap-1 text-xs text-nexus-accent"
                      title={`${number.format(packaged.get(lot.id) ?? 0)} dans le colis`}
                    >
                      <Package className="size-3.5" aria-hidden />
                      <span className="sr-only">
                        {number.format(packaged.get(lot.id) ?? 0)} dans le colis
                      </span>
                    </span>
                  ) : null}
                </span>
              )}
              renderLotActions={(lot) => (
                <>
                  <AdjustQuantityButton
                    mode="remove"
                    disabled={adjustMutation.isPending}
                    onSubmit={(amount) =>
                      adjustMutation.mutate({ id: lot.id, delta: -amount })
                    }
                  />
                  <AdjustQuantityButton
                    mode="add"
                    disabled={adjustMutation.isPending}
                    onSubmit={(amount) =>
                      adjustMutation.mutate({ id: lot.id, delta: amount })
                    }
                  />
                </>
              )}
              renderFooter={(group, active) => {
                const allVisible = group.lots.every((lot) => lot.orgVisible);
                const someVisible = group.lots.some((lot) => lot.orgVisible);
                return (
                  <>
                    <OrgVisibleCheckbox
                      checked={allVisible}
                      indeterminate={someVisible && !allVisible}
                      disabled={toggleVisibilityMutation.isPending}
                      onChange={() =>
                        toggleVisibilityMutation.mutate({
                          ids: group.lots.map((lot) => lot.id),
                          orgVisible: !allVisible,
                        })
                      }
                    />
                    <AdjustQuantityButton
                      mode="add"
                      label="Ajouter au colis"
                      icon={Package}
                      max={availableOf(active)}
                      maxMessage={
                        active.reserved !== undefined
                          ? `Seuls ${number.format(availableOf(active))} sont disponibles : le reste est réservé.`
                          : `Au plus ${number.format(active.quantity)}`
                      }
                      disabled={availableOf(active) <= 0}
                      onSubmit={(amount) => addToPackage(active, amount)}
                    />
                    <DeleteIconButton
                      itemName={
                        active.quality != null
                          ? `${active.name} (Q ${active.quality})`
                          : active.name
                      }
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(active.id)}
                    />
                  </>
                );
              }}
            />
          )}
        </div>

        {packageEntries.length > 0 ? (
          <PackagePanel
            entries={packageEntries}
            onChange={setPackageEntries}
            onSent={setSentParcel}
          />
        ) : null}
      </div>

      <SentParcelModal
        parcel={sentParcel}
        onClose={() => setSentParcel(null)}
      />
      <ReceiveParcelModal
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
      />
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
      quality: parseMinQuality(quality),
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
