import { apiRequest } from "@/lib/api-client";
import type {
  PlaceType,
  PrivatePlace,
  PrivatePlaceListResponse,
} from "@/types/nexus";

/**
 * Les lieux privés du joueur et ceux de ses organisations. Les créer, les
 * modifier ou les proposer au public se fait sur le site : l'app les lit.
 */
const PRIVATE_PLACES = "/api/lieux/prives";

export function listPrivatePlaces(
  filters: {
    query?: string;
    type?: PlaceType;
    system?: string;
    body?: string;
  } = {},
) {
  return apiRequest<PrivatePlaceListResponse>(PRIVATE_PLACES, {
    params: {
      query: filters.query,
      type: filters.type,
      system: filters.system,
      body: filters.body,
    },
  });
}

export function getPrivatePlace(slug: string) {
  return apiRequest<PrivatePlace>(
    `${PRIVATE_PLACES}/${encodeURIComponent(slug)}`,
  );
}
