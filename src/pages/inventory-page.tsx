import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
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
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Select,
} from "@/components/ui";
import { formatDate } from "@/lib/utils";
import type { InventoryItemInput } from "@/types/nexus";

export default function InventoryPage() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [showForm, setShowForm] = useState(false);

  const query = useDebounced(search);

  const locationsQuery = useQuery({
    queryKey: ["locations"],
    queryFn: () => listLocations(),
    staleTime: 10 * 60_000,
  });

  const itemsQuery = useQuery({
    queryKey: ["inventory-items", query, locationFilter],
    queryFn: () =>
      listInventoryItems({
        query: query || undefined,
        locationId: locationFilter || undefined,
      }),
  });

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

  return (
    <>
      <PageHeader
        title="Inventaire"
        description="Vos ressources, par lieu de stockage."
        actions={
          <Button size="sm" onClick={() => setShowForm((open) => !open)}>
            <Plus className="h-3.5 w-3.5" />
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

      <Card className="mb-6 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Recherche">
            <Input
              value={search}
              placeholder="Nom de la ressource…"
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
          <Field label="Lieu">
            <Select
              value={locationFilter}
              onChange={(event) => setLocationFilter(event.target.value)}
            >
              <option value="">Tous</option>
              {locationsQuery.data?.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {itemsQuery.isPending ? (
        <LoadingState />
      ) : itemsQuery.isError ? (
        <ErrorState
          error={itemsQuery.error}
          onRetry={() => void itemsQuery.refetch()}
        />
      ) : itemsQuery.data.length === 0 ? (
        <EmptyState
          title="Inventaire vide"
          description="Ajoutez une première ressource pour la retrouver depuis le bureau."
        />
      ) : (
        <div className="space-y-2">
          {itemsQuery.data.map((item) => (
            <Card key={item.id} className="flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-nexus-bright">
                  {item.name}
                </p>
                <p className="mt-0.5 text-xs text-nexus-accent/50">
                  {item.location?.name ?? "Lieu inconnu"}
                  {item.quality != null ? ` · qualité ${item.quality}` : ""}
                  {` · maj ${formatDate(item.updatedAt)}`}
                </p>
              </div>

              <div className="shrink-0 text-right">
                <p className="text-sm text-nexus-bright">
                  {item.quantity.toLocaleString("fr-FR")}
                  {item.unit ? ` ${item.unit}` : ""}
                </p>
              </div>

              <label
                className="flex shrink-0 items-center gap-1.5 text-[11px] text-nexus-accent/60"
                title="Rendre visible aux membres de vos organisations"
              >
                <input
                  type="checkbox"
                  checked={item.orgVisible}
                  disabled={toggleVisibilityMutation.isPending}
                  onChange={(event) =>
                    toggleVisibilityMutation.mutate({
                      id: item.id,
                      orgVisible: event.target.checked,
                    })
                  }
                  className="h-3.5 w-3.5 rounded border-nexus-accent/30 bg-nexus-abyss accent-nexus-accent"
                />
                Org
              </label>

              <Button
                variant="danger"
                size="sm"
                aria-label={`Supprimer ${item.name}`}
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(item.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </Card>
          ))}
        </div>
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
