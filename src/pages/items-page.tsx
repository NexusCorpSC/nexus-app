import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listItemFacets, listItems } from "@/lib/api/items";
import { useDebounced } from "@/hooks/use-debounced";
import { ItemCard } from "@/components/item-card";
import { ITEM_KIND_LABELS, ITEM_KINDS, type ItemKind } from "@/types/nexus";
import {
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
        description="Tout ce qui existe en jeu : objets, armes, véhicules et ressources."
      />

      <Toolbar className="mb-3">
        <SearchField
          label="Rechercher un objet"
          value={search}
          placeholder="Nom, fabricant, variante…"
          onChange={(event) =>
            updateFilter(() => setSearch(event.target.value))
          }
        />

        <ToolbarSelect
          label="Catégorie"
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
        </ToolbarSelect>

        {subcategories.length ? (
          <ToolbarSelect
            label="Sous-catégorie"
            value={subcategory}
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
          </ToolbarSelect>
        ) : null}

        <ToolbarSelect
          label="Fabricant"
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
        </ToolbarSelect>
      </Toolbar>

      <div className="mb-5 flex flex-wrap gap-2">
        <Chip
          active={kind === ""}
          onClick={() => updateFilter(() => setKind(""))}
        >
          Tous
        </Chip>
        {ITEM_KINDS.map((value) => (
          <Chip
            key={value}
            active={kind === value}
            onClick={() => updateFilter(() => setKind(value))}
          >
            {ITEM_KIND_LABELS[value]}
          </Chip>
        ))}
      </div>

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
          <p className="mb-3 text-xs text-nexus-dim">
            {itemsQuery.data.total} résultat
            {itemsQuery.data.total > 1 ? "s" : ""}
          </p>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
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
