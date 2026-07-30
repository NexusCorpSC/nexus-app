/**
 * Types mirroring the Nexus Tools API responses.
 * Kept in sync by hand with `nexus-tools/types/*` and the `app/api` routes.
 */

/* ------------------------------------------------------------------ */
/* Crafting / blueprints                                               */
/* ------------------------------------------------------------------ */

export type BlueprintStatistics = {
  [statName: string]: { value: string | number; unit?: string };
};

export type BlueprintRecipeComponentOption = {
  quantity: number;
  minQuality?: number;
  name: string;
};

export type BlueprintRecipeComponent = {
  name: string;
  options: BlueprintRecipeComponentOption[];
};

export type BlueprintRecipe = {
  craftingTime: number;
  components: BlueprintRecipeComponent[];
};

export type Blueprint = {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  subcategory?: string;
  imageUrl?: string;
  owned?: boolean;
  /**
   * Owned by everyone, so nothing to add and nothing to drop. Comes back
   * alongside `owned`, which means only for a signed-in caller.
   */
  isDefault?: boolean;
  tier?: number;
  craftingTime?: number;
  statistics?: BlueprintStatistics;
  recipe?: BlueprintRecipe;
  obtention?: string;
};

export type BlueprintCategory = {
  category: string;
  subcategories: string[];
};

export type BlueprintPage = {
  blueprints: Blueprint[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

/* ------------------------------------------------------------------ */
/* Missions                                                            */
/* ------------------------------------------------------------------ */

export type MissionFaction = {
  _id: string;
  name: string;
  /** Only returned by `/api/missions/factions`. */
  missionCount?: number;
  blueprintCount?: number;
};

export type MissionBlueprint = {
  _id: string;
  name: string;
  slug: string;
  category?: string;
  subcategory?: string;
  imageUrl?: string;
};

export type Mission = {
  _id: string;
  title: string;
  description?: string;
  category?: string;
  missionType?: string;
  canBeShared?: boolean;
  illegal?: boolean;
  rewardUEC?: number;
  faction?: MissionFaction;
  blueprintDetails?: MissionBlueprint[];
};

export type MissionPage = {
  missions: Mission[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

/* ------------------------------------------------------------------ */
/* Reputations                                                         */
/* ------------------------------------------------------------------ */

export type FactionLevel = {
  level: number;
  name: string;
  isDefault: boolean;
};

export type FactionCareer = {
  name: string;
  levels: FactionLevel[];
};

export type RepFaction = {
  name: string;
  standings: string[];
  defaultStanding: string;
  careers: FactionCareer[];
};

export type PlayerReputations = {
  [factionName: string]: {
    standing?: string;
    careers?: {
      [careerName: string]: { level: FactionLevel };
    };
  };
};

/* ------------------------------------------------------------------ */
/* Inventory                                                           */
/* ------------------------------------------------------------------ */

export type Location = {
  id: string;
  name: string;
  slug?: string;
  system?: string;
  userId?: string;
};

export type InventoryItem = {
  id: string;
  name: string;
  description?: string;
  quality?: number;
  quantity: number;
  unit?: string;
  locationId: string;
  userId: string;
  orgVisible: boolean;
  updatedAt: string;
  location: Location | null;
};

export type InventoryItemInput = {
  name: string;
  description?: string;
  quality?: number;
  quantity: number;
  unit?: string;
  locationId: string;
  orgVisible?: boolean;
};

/* ------------------------------------------------------------------ */
/* Organizations                                                       */
/* ------------------------------------------------------------------ */

export type Organization = {
  id: string;
  name: string;
  tag: string;
  description?: string;
  image?: string;
  public: boolean;
};

export type UserOrganization = Organization & {
  rank: string | null;
  editor: boolean;
};

/** Org inventory rows carry the owning member's display name. */
export type OrgInventoryItem = Omit<InventoryItem, "orgVisible" | "userId"> & {
  userId?: string;
  ownerName: string;
};

export type OrganizationsResponse = {
  organizations: Organization[];
  userOrganizations: UserOrganization[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

/* ------------------------------------------------------------------ */
/* Notes                                                               */
/* ------------------------------------------------------------------ */

/** One scratch pad per user, mirroring `types/notes.ts` in nexus-tools. */
export type Note = {
  content: string;
  /** ISO date, null when never saved. */
  updatedAt: string | null;
};

export const EMPTY_NOTE: Note = { content: "", updatedAt: null };

export const NOTE_CONTENT_MAX_LENGTH = 20000;

/* ------------------------------------------------------------------ */
/* Factions                                                            */
/* ------------------------------------------------------------------ */

/** A blueprint as `GET /api/factions` lists it: enough to link to its page. */
export type FactionBlueprint = {
  _id: string;
  name: string;
  slug: string;
  category?: string;
  subcategory?: string;
};

/**
 * A faction and the blueprints its missions reward, from `GET /api/factions`.
 * The route answers with raw Mongo documents, hence `_id` rather than `id`.
 */
export type FactionWithBlueprints = {
  _id: string;
  name: string;
  blueprints: FactionBlueprint[];
};

/* ------------------------------------------------------------------ */
/* Blueprint ownership inside an organization                          */
/* ------------------------------------------------------------------ */

/** A member of one of your organizations who owns a given blueprint. */
export type BlueprintOrgMember = {
  userId: string;
  name: string;
  avatar?: string;
};

/* ------------------------------------------------------------------ */
/* Generalized search                                                  */
/* ------------------------------------------------------------------ */

/**
 * Everything `GET /api/search` can return, mirroring `types/search.ts` in
 * nexus-tools. The order is the tie-breaker the API uses between two results
 * of equal score.
 */
export const SEARCH_TYPES = [
  "blueprint",
  "mission",
  "faction",
  "shopItem",
  "shop",
  "organization",
  "cargoShip",
  "inventoryItem",
] as const;

export type SearchType = (typeof SEARCH_TYPES)[number];

/** Shorter than this, the API answers 400 rather than searching. */
export const MIN_SEARCH_QUERY_LENGTH = 2;

export type SearchResult = {
  type: SearchType;
  /** Mongo id, slug or nanoid, depending on the type. */
  id: string;
  title: string;
  /** Short qualifier: category, faction, shop, location… */
  subtitle?: string;
  description?: string;
  /** Relative link to the **website** page showing this entity. */
  url: string;
  imageUrl?: string;
  meta?: Record<string, string | number | boolean>;
  /** Relevance, highest first. Only comparable within one response. */
  score: number;
};

export type SearchResponse = {
  query: string;
  /** Types actually searched, after dropping the ones the caller cannot read. */
  types: SearchType[];
  limit: number;
  total: number;
  results: SearchResult[];
  countsByType: Record<string, number>;
  hasMore: SearchType[];
};

/* ------------------------------------------------------------------ */
/* Squads                                                              */
/* ------------------------------------------------------------------ */

export const ANNOUNCEMENTS_MAX_LENGTH = 2000;
export const POSITION_MAX_LENGTH = 120;

export type SquadMember = {
  userId: string;
  name: string;
  /** Decides succession: the longest-standing member takes over. */
  joinedAt: string;
  ready: boolean;
  /** «actif» when true, «éliminé» when false. */
  alive: boolean;
  position: string;
};

export type Squad = {
  id: string;
  name: string;
  /** Short, spoken out loud, shared to let others in. */
  code: string;
  leaderId: string;
  announcements: string;
  members: SquadMember[];
  version: number;
  updatedAt: string;
};

/** What a member may change about themselves, and a leader about anyone. */
export type SquadMemberPatch = {
  ready?: boolean;
  alive?: boolean;
  position?: string;
};
