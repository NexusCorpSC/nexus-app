import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listPlaceFacets, listPlaces } from "@/lib/api/places";
import { useDebounced } from "@/hooks/use-debounced";
import { PlaceCard } from "@/components/place-card";
import {
  PLACE_SERVICE_LABELS,
  PLACE_TYPE_LABELS,
  PLACE_TYPES,
  isPlaceService,
  type PlaceService,
  type PlaceType,
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
 * `value in PLACE_TYPE_LABELS` dirait oui à `toString` : la chaîne des
 * prototypes en fait partie. On interroge la liste, comme `isPlaceService`.
 */
function isPlaceType(value: string): value is PlaceType {
  return (PLACE_TYPES as readonly string[]).includes(value);
}

/**
 * Les lieux du 'verse, comme `/lieux` les liste sur le site.
 *
 * La vue arborescente du site n'est pas reprise : sur un écran de bureau à
 * côté du jeu, ce qu'on cherche c'est un lieu précis, pas la structure du
 * système. Le fil « Stanton › Hurston › Lorville » de chaque carte suffit à
 * savoir où l'on est, et la fiche d'un lieu mène à ce qu'il contient.
 *
 * Un choix à assumer, le même que sur le site : `?service=medical` remonte le
 * lieu **qui a** le service, pas ceux qui le contiennent. Chercher « médical »
 * donne l'hôpital, pas Lorville.
 */
export default function PlacesPage() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<PlaceType | "">("");
  const [system, setSystem] = useState("");
  const [body, setBody] = useState("");
  const [service, setService] = useState<PlaceService | "">("");
  const [page, setPage] = useState(1);

  const query = useDebounced(search);

  const facetsQuery = useQuery({
    queryKey: ["place-facets"],
    queryFn: listPlaceFacets,
    staleTime: 30 * 60_000,
  });

  // Les corps du système choisi seulement : proposer les lunes de Pyro pendant
  // qu'on regarde Stanton ne mène qu'à des listes vides.
  const bodies = useMemo(() => {
    const all = facetsQuery.data?.bodies ?? [];
    return system ? all.filter((entry) => entry.systemSlug === system) : all;
  }, [facetsQuery.data, system]);

  const placesQuery = useQuery({
    queryKey: ["places", query, type, system, body, service, page],
    queryFn: () =>
      listPlaces({
        query: query || undefined,
        type: type || undefined,
        system: system || undefined,
        body: body || undefined,
        service: service || undefined,
        page,
      }),
    placeholderData: keepPreviousData,
  });

  /** Tout changement de filtre ramène à la première page. */
  function updateFilter(apply: () => void) {
    apply();
    setPage(1);
  }

  return (
    <>
      <PageHeader
        title="Lieux"
        description="Villes, stations et avant-postes du 'verse, avec les services qu'on y trouve, les magasins qui s'y tiennent et les cartes relevées."
      />

      <Card className="mb-6 p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Recherche" className="sm:col-span-2 lg:col-span-1">
            <Input
              value={search}
              placeholder="Nom d'un lieu…"
              onChange={(event) =>
                updateFilter(() => setSearch(event.target.value))
              }
            />
          </Field>

          <Field label="Type">
            <Select
              value={type}
              onChange={(event) =>
                updateFilter(() => {
                  const value = event.target.value;
                  setType(isPlaceType(value) ? value : "");
                })
              }
            >
              <option value="">Tous</option>
              {facetsQuery.data?.types.map((entry) =>
                isPlaceType(entry.value) ? (
                  <option key={entry.value} value={entry.value}>
                    {PLACE_TYPE_LABELS[entry.value]} ({entry.count})
                  </option>
                ) : null,
              )}
            </Select>
          </Field>

          <Field label="Système">
            <Select
              value={system}
              onChange={(event) =>
                updateFilter(() => {
                  setSystem(event.target.value);
                  // Le corps choisi appartenait peut-être à l'autre système.
                  setBody("");
                })
              }
            >
              <option value="">Tous</option>
              {facetsQuery.data?.systems.map((entry) => (
                <option key={entry.slug} value={entry.slug}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Planète ou lune">
            <Select
              value={body}
              disabled={!bodies.length}
              onChange={(event) =>
                updateFilter(() => setBody(event.target.value))
              }
            >
              <option value="">Tous</option>
              {bodies.map((entry) => (
                <option key={entry.slug} value={entry.slug}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Service">
            <Select
              value={service}
              onChange={(event) =>
                updateFilter(() => {
                  const value = event.target.value;
                  setService(isPlaceService(value) ? value : "");
                })
              }
            >
              <option value="">Tous</option>
              {facetsQuery.data?.services.map((entry) =>
                isPlaceService(entry.value) ? (
                  <option key={entry.value} value={entry.value}>
                    {PLACE_SERVICE_LABELS[entry.value]} ({entry.count})
                  </option>
                ) : null,
              )}
            </Select>
          </Field>
        </div>
      </Card>

      {placesQuery.isPending ? (
        <LoadingState />
      ) : placesQuery.isError ? (
        <ErrorState
          error={placesQuery.error}
          onRetry={() => void placesQuery.refetch()}
        />
      ) : placesQuery.data.places.length === 0 ? (
        <EmptyState
          title="Aucun lieu trouvé"
          description="Essayez un autre terme de recherche ou élargissez les filtres."
        />
      ) : (
        <>
          <p className="mb-3 text-xs text-nexus-accent/50">
            {placesQuery.data.total} résultat
            {placesQuery.data.total > 1 ? "s" : ""}
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {placesQuery.data.places.map((place) => (
              <PlaceCard key={place.id} place={place} />
            ))}
          </div>

          <Pagination
            page={placesQuery.data.page}
            totalPages={placesQuery.data.totalPages}
            onPageChange={setPage}
          />
        </>
      )}
    </>
  );
}
