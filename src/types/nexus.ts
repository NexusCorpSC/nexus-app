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
/* In-game objects (items, weapons, vehicles, resources)               */
/* ------------------------------------------------------------------ */

/**
 * What exists in the game, as opposed to the blueprints that make it.
 * Mirrors `types/items.ts` in nexus-tools and the `/api/items` routes.
 */
export const ITEM_KINDS = ["item", "weapon", "vehicle", "resource"] as const;

export type ItemKind = (typeof ITEM_KINDS)[number];

export function isItemKind(value: string): value is ItemKind {
  return (ITEM_KINDS as readonly string[]).includes(value);
}

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  item: "Objet",
  weapon: "Arme",
  vehicle: "Véhicule",
  resource: "Ressource",
};

export type ItemStatistics = BlueprintStatistics;

/**
 * A slot holding another object: a vehicle hardpoint, a mounted component, a
 * weapon attachment. `itemSlug` points at the fiche when the object is in the
 * catalogue; `itemName` carries its name otherwise.
 */
export type ItemSlot = {
  label: string;
  /** 2 for S2. */
  size?: number;
  itemSlug?: string;
  itemName?: string;
  /** Copies mounted: «2 × Repeater». */
  quantity?: number;
  note?: string;
};

export type ResolvedItemSlot = ItemSlot & {
  /** Set when the slot names an object that has a fiche, by slug or by name. */
  mounted?: ItemSummary;
};

export type VehicleDetails = {
  crew?: number;
  /** m/s */
  speedMax?: number;
  /** m/s */
  speedScm?: number;
  /** SCU */
  cargoScu?: number;
  /** kg */
  mass?: number;
  /** metres */
  length?: number;
  width?: number;
  height?: number;
  hardpoints?: ItemSlot[];
  components?: ItemSlot[];
};

export type WeaponStat = {
  label: string;
  value: number;
  unit?: string;
};

export type WeaponFireMode = {
  /** As the game shows it: AUTO, SEMI, BURST, CHARGE. */
  label: string;
  rpm?: number;
  dps?: number;
  ammoPerShot?: number;
  pelletsPerShot?: number;
  burstCount?: number;
  heatPerShot?: number;
};

/** Cone of fire in degrees; `decay` in degrees per second. */
export type WeaponSpread = {
  min?: number;
  max?: number;
  firstShot?: number;
  perShot?: number;
  decay?: number;
};

export type WeaponAmmunition = {
  size?: number;
  /** m/s */
  speed?: number;
  /** metres */
  range?: number;
  /** seconds */
  lifetime?: number;
  capacity?: number;
  damageType?: string;
  damagePerShot?: number;
  /** metres */
  falloffStart?: number;
  falloffPerMeter?: number;
  falloffMinDamage?: number;
  penetration?: number;
};

export type WeaponDetails = {
  damageType?: string;
  caliber?: string;
  profile?: WeaponStat[];
  /** rounds per minute */
  rateOfFire?: number;
  magazine?: number;
  /** seconds */
  reloadTime?: number;
  /** kg */
  mass?: number;
  attachments?: ItemSlot[];
  fireModes?: WeaponFireMode[];
  /** Hip fire. */
  spread?: WeaponSpread;
  /** Aiming down sights. */
  adsSpread?: WeaponSpread;
  ammunition?: WeaponAmmunition;
};

export type ResourceMarketSide = "buy" | "sell" | "grey";

export type ResourceMarket = {
  location: string;
  /** From the counter's side: it buys, it sells, or grey market. */
  side: ResourceMarketSide;
  /** aUEC per unit */
  price: number;
  /** Absent = unlimited. */
  stock?: number;
};

export type ResourceExtraction = {
  location: string;
  method?: string;
  frequency?: "common" | "occasional" | "risky";
};

export type ResourceRefining = {
  process?: string;
  /** percent */
  yield?: number;
  durationSeconds?: number;
  /** aUEC */
  cost?: number;
  outputName?: string;
};

export type ResourceDetails = {
  form?: string;
  volatile?: boolean;
  unitVolumeScu?: number;
  /** percent */
  purityMin?: number;
  purityMax?: number;
  markets?: ResourceMarket[];
  /** Oldest first. */
  priceHistory?: number[];
  refining?: ResourceRefining;
  extraction?: ResourceExtraction[];
  transportNote?: string;
  /** ISO date */
  pricesUpdatedAt?: string;
};

export type Item = {
  id: string;
  slug: string;
  name: string;
  kind: ItemKind;
  description?: string;
  category: string;
  subcategory?: string;
  manufacturer?: string;
  size?: number;
  tier?: number;
  imageUrl?: string;
  statistics?: ItemStatistics;
  obtention?: string;
  blueprintSlugs?: string[];
  variantGroup?: string;
  variantName?: string;
  setId?: string;
  setName?: string;
  /** Absent = fiche left to complete. */
  vehicle?: VehicleDetails;
  weapon?: WeaponDetails;
  resource?: ResourceDetails;
  updatedAt?: string;
};

/** What a card or a related-objects list needs. */
export type ItemSummary = Pick<
  Item,
  | "id"
  | "slug"
  | "name"
  | "kind"
  | "category"
  | "subcategory"
  | "manufacturer"
  | "imageUrl"
  | "tier"
  | "variantName"
  | "setName"
>;

/** A blueprint as an object's fiche lists it. */
export type ItemBlueprintLink = {
  slug: string;
  name: string;
  category?: string;
  subcategory?: string;
  imageUrl?: string;
  tier?: number;
  /** Consumed quantity, when the blueprint uses the object as a material. */
  quantity?: number;
};

/** A firing statistic scaled to its class: `max` fills the bar. */
export type WeaponStatScale = WeaponStat & {
  max: number;
  average?: number;
  /** False when no other weapon of the class carries it: nothing to scale. */
  comparable: boolean;
};

export type WeaponPeer = {
  slug: string;
  name: string;
  value: number;
  isCurrent: boolean;
};

export type ItemDetails = Item & {
  blueprints: ItemBlueprintLink[];
  /** Whether the blueprints were inferred from the name rather than declared. */
  blueprintsInferred: boolean;
  consumedBy: ItemBlueprintLink[];
  /** Every variant of the group, this one included. Empty when alone. */
  variants: ItemSummary[];
  /** Every piece of the set, this one included. Empty when alone. */
  setItems: ItemSummary[];
  hardpoints: ResolvedItemSlot[];
  components: ResolvedItemSlot[];
  attachments: ResolvedItemSlot[];
  weaponProfile: WeaponStatScale[];
  weaponPeers: WeaponPeer[];
  /** Vehicles and weapons carrying this object in one of their slots. */
  mountedOn: ItemSummary[];
};

export type ItemCategory = {
  category: string;
  subcategories: string[];
};

export type ItemFacets = {
  categories: ItemCategory[];
  manufacturers: string[];
  variantGroups: { id: string; name: string }[];
  sets: { id: string; name: string }[];
};

export type ItemPage = {
  items: ItemSummary[];
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
  "item",
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
  /**
   * Commands the squad alongside the leader, with exactly the same powers —
   * appointing further lieutenants and handing the squad over included.
   *
   * Optional because the wire really can omit it: a squad created before the
   * rank existed carries no such field, and nothing between here and Mongo adds
   * one. Absent reads as «no», which is what every use of it below assumes.
   */
  lieutenant?: boolean;
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

/**
 * What a member may change about themselves, and what commanding the squad lets
 * you change about anyone. `lieutenant` is never self-reported: the API refuses
 * it from anyone who does not command.
 */
export type SquadMemberPatch = {
  ready?: boolean;
  alive?: boolean;
  position?: string;
  lieutenant?: boolean;
};
