import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "use-intl";
import { listPlaceFacets, listPlaces } from "@/lib/api/places";
import { useDebounced } from "@/hooks/use-debounced";
import {
  pageFrom,
  useInitialParams,
  useUrlFilters,
} from "@/hooks/use-url-filters";
import { PlaceCard } from "@/components/place-card";
import {
  PLACE_TYPES,
  isPlaceService,
  type PlaceService,
  type PlaceType,
} from "@/types/nexus";
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
 * `value in { … }` dirait oui à `toString` : la chaîne des
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
  const t = useTranslations("Places");
  const params = useInitialParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [type, setType] = useState<PlaceType | "">(
    (params.get("type") as PlaceType | null) ?? "",
  );
  const [system, setSystem] = useState(params.get("system") ?? "");
  const [body, setBody] = useState(params.get("body") ?? "");
  const [service, setService] = useState<PlaceService | "">(
    (params.get("service") as PlaceService | null) ?? "",
  );
  const [page, setPage] = useState(() => pageFrom(params));

  const query = useDebounced(search);
  useUrlFilters({ q: query, type, system, body, service, page });

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
        title={t("list.title")}
        description={t("list.description")}
      />

      <Toolbar className="mb-3">
        <SearchField
          label={t("list.searchLabel")}
          value={search}
          placeholder={t("list.searchPlaceholder")}
          onChange={(event) =>
            updateFilter(() => setSearch(event.target.value))
          }
        />

        <ToolbarSelect
          label={t("list.system")}
          value={system}
          onChange={(event) =>
            updateFilter(() => {
              setSystem(event.target.value);
              // Le corps choisi appartenait peut-être à l'autre système.
              setBody("");
            })
          }
        >
          <option value="">{t("list.all")}</option>
          {facetsQuery.data?.systems.map((entry) => (
            <option key={entry.slug} value={entry.slug}>
              {entry.name}
            </option>
          ))}
        </ToolbarSelect>

        <ToolbarSelect
          label={t("list.body")}
          value={body}
          disabled={!bodies.length}
          onChange={(event) => updateFilter(() => setBody(event.target.value))}
        >
          <option value="">{t("list.all")}</option>
          {bodies.map((entry) => (
            <option key={entry.slug} value={entry.slug}>
              {entry.name}
            </option>
          ))}
        </ToolbarSelect>

        <ToolbarSelect
          label={t("list.service")}
          value={service}
          onChange={(event) =>
            updateFilter(() => {
              const value = event.target.value;
              setService(isPlaceService(value) ? value : "");
            })
          }
        >
          <option value="">{t("list.all")}</option>
          {facetsQuery.data?.services.map((entry) =>
            isPlaceService(entry.value) ? (
              <option key={entry.value} value={entry.value}>
                {t(`services.${entry.value}`)} ({entry.count})
              </option>
            ) : null,
          )}
        </ToolbarSelect>
      </Toolbar>

      <div className="mb-5 flex flex-wrap gap-2">
        <Chip
          active={type === ""}
          onClick={() => updateFilter(() => setType(""))}
        >
          {t("list.all")}
        </Chip>
        {facetsQuery.data?.types.map((entry) => {
          const value = entry.value;
          return isPlaceType(value) ? (
            <Chip
              key={value}
              active={type === value}
              onClick={() => updateFilter(() => setType(value))}
            >
              {t(`types.${value}`)}
              <span className="ml-1.5 opacity-60">{entry.count}</span>
            </Chip>
          ) : null;
        })}
      </div>

      {placesQuery.isPending ? (
        <LoadingState />
      ) : placesQuery.isError ? (
        <ErrorState
          error={placesQuery.error}
          onRetry={() => void placesQuery.refetch()}
        />
      ) : placesQuery.data.places.length === 0 ? (
        <EmptyState
          title={t("list.emptyTitle")}
          description={t("list.emptyDescription")}
        />
      ) : (
        <>
          <p className="mb-3 text-xs text-nexus-dim">
            {t("list.results", { count: placesQuery.data.total })}
          </p>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
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
