import { apiRequest } from "@/lib/api-client";
import type {
  PlaceDetails,
  PlaceFacets,
  PlaceListResponse,
  PlacePlansResponse,
  PlaceService,
  PlaceType,
} from "@/types/nexus";

/**
 * Le catalogue des lieux du 'verse.
 *
 * Les routes du site sont en français — `/api/lieux` — parce que c'est là que
 * la rubrique a été écrite ; on les appelle telles quelles plutôt que
 * d'inventer un alias qui n'existerait que chez nous.
 */
const PLACES = "/api/lieux";

export type PlaceFilters = {
  query?: string;
  type?: PlaceType;
  system?: string;
  body?: string;
  service?: PlaceService;
  /** Les lieux contenus directement par celui-ci. */
  parent?: string;
  /** Tout un sous-arbre, descendants indirects compris. */
  under?: string;
  sort?: string;
  page?: number;
  limit?: number;
};

export function listPlaces(filters: PlaceFilters = {}) {
  return apiRequest<PlaceListResponse>(PLACES, {
    params: {
      query: filters.query,
      type: filters.type,
      system: filters.system,
      body: filters.body,
      service: filters.service,
      parent: filters.parent,
      under: filters.under,
      sort: filters.sort,
      page: filters.page,
      limit: filters.limit,
    },
  });
}

/** Les valeurs que les filtres proposent : types, systèmes, corps, services. */
export function listPlaceFacets() {
  return apiRequest<PlaceFacets>(`${PLACES}/facets`);
}

/**
 * Un lieu avec tout ce que sa fiche montre : ses ancêtres, ce qu'il contient,
 * les magasins de tout son sous-arbre, et ses cartes.
 */
export function getPlace(slug: string) {
  return apiRequest<PlaceDetails>(`${PLACES}/${encodeURIComponent(slug)}`);
}

/**
 * Le strict nécessaire pour afficher la carte d'un lieu.
 *
 * C'est ce que demande l'overlay : il n'a que faire des magasins ni des
 * enfants, et cette route-là ne les charge pas.
 */
export function getPlacePlans(slug: string) {
  return apiRequest<PlacePlansResponse>(
    `${PLACES}/${encodeURIComponent(slug)}/plans`,
  );
}
