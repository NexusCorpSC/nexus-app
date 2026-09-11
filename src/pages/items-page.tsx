import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listItemFacets, listItems } from "@/lib/api/items";
import { useDebounced } from "@/hooks/use-debounced";
import { ItemCard } from "@/components/item-card";
import {
  ITEM_KIND_LABELS,
  ITEM_KINDS,
  isItemKind,
  type ItemKind,
} from "@/types/nexus";
import {
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

/**
 * The catalogue of what exists in the game — objects, weapons, vehicles,
 * resources — as `/items` on the website lists it. The filters are the ones
 * the API takes; the values they offer come from `/api/items/facets`.
 */
export default function ItemsPage() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<ItemKind | "">("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [page, setPage] = useState(1);

  const query = useDebounced(search);

  const facetsQuery = useQuery({
    queryKey: ["item-facets"],
    queryFn: listItemFacets,
    staleTime: 30 * 60_000,
  });

  const subcategories = useMemo(
    () =>
      facetsQuery.data?.categories.find((c) => c.category === category)
        ?.subcategories ?? [],
    [facetsQuery.data, category],
  );

  const itemsQuery = useQuery({
    queryKey: ["items", query, kind, category, subcategory, manufacturer, page],
    queryFn: () =>
      listItems({
        query: query || undefined,
        kind: kind || undefined,
        category: category || undefined,
        subcategory: subcategory || undefined,
        manufacturer: manufacturer || undefined,
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
        title="Objets"
        description="Tout ce qui existe en jeu : objets, armes, véhicules et ressources, avec leurs variantes, leurs ensembles et les blueprints qui les fabriquent."
      />

      <Card className="mb-6 p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Recherche" className="sm:col-span-2 lg:col-span-1">
            <Input
              value={search}
              placeholder="Nom, fabricant, variante…"
              onChange={(event) =>
                updateFilter(() => setSearch(event.target.value))
              }
            />
          </Field>

          <Field label="Type">
            <Select
              value={kind}
              onChange={(event) =>
                updateFilter(() => {
                  const value = event.target.value;
                  setKind(isItemKind(value) ? value : "");
                })
              }
            >
              <option value="">Tous</option>
              {ITEM_KINDS.map((value) => (
                <option key={value} value={value}>
                  {ITEM_KIND_LABELS[value]}
                </option>
              ))}
            </Select>
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
              {facetsQuery.data?.categories.map((c) => (
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

          <Field label="Fabricant">
            <Select
              value={manufacturer}
              disabled={!facetsQuery.data?.manufacturers.length}
              onChange={(event) =>
                updateFilter(() => setManufacturer(event.target.value))
              }
            >
              <option value="">Tous</option>
              {facetsQuery.data?.manufacturers.map((name) => (
                <option key={name} value={name}>
                  {name}
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
      ) : itemsQuery.data.items.length === 0 ? (
        <EmptyState
          title="Aucun objet trouvé"
          description="Essayez un autre terme de recherche ou élargissez les filtres."
        />
      ) : (
        <>
          <p className="mb-3 text-xs text-nexus-accent/50">
            {itemsQuery.data.total} résultat
            {itemsQuery.data.total > 1 ? "s" : ""}
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {itemsQuery.data.items.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>

          <Pagination
            page={itemsQuery.data.page}
            totalPages={itemsQuery.data.totalPages}
            onPageChange={setPage}
          />
        </>
      )}
    </>
  );
}
