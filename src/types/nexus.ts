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

/**
 * Les plans du véhicule : vues orthographiques et modèle 3D. Les vues plates
 * s'affichent ici ; le modèle 3D reste le format de la fiche en ligne, que le
 * bouton « Ouvrir sur le web » va chercher.
 */
export type VehiclePlans = {
  top?: string;
  side?: string;
  front?: string;
  /** Modèle glTF, affiché par la fiche web. */
  holo?: string;
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
  plans?: VehiclePlans;
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
  /** Possessed by the reader (or unlocked by default). Only when signed in. */
  owned?: boolean;
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
  /** Position relative to the default rank: negative below it (Hostile, Not Eligible). */
  level: number;
  name: string;
  isDefault: boolean;
  /** In-game rank key (`Technician_Rank2`), set by the site's import. */
  gameName?: string;
  /** Reputation needed for this rank, set by the site's import. */
  minReputation?: number;
};

export type FactionCareer = {
  name: string;
  levels: FactionLevel[];
  /** In-game ladder key (`Security_MercenaryGuild`), set by the site's import. */
  gameScope?: string;
};

export type RepFaction = {
  name: string;
  standings: string[];
  defaultStanding: string;
  careers: FactionCareer[];
  gameId?: string;
  description?: string;
  lawful?: boolean;
  focus?: string;
  headquarters?: string;
  /** Game version the faction disappeared in; kept for players who followed it. */
  removedInVersion?: string;
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
  /**
   * The part of `quantity` promised to a parcel still waiting: it cannot go
   * in another one. Absent when none is.
   */
  reserved?: number;
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

/** A lot in a parcel; `itemId` and `locationId` only for its sender. */
export type ParcelItem = {
  itemId?: string;
  name: string;
  quality?: number;
  quantity: number;
  unit?: string;
  locationId?: string;
  locationName?: string;
};

export type ParcelStatus = "pending" | "delivered" | "cancelled" | "expired";

/** A parcel as `/api/inventory/parcels` returns it. */
export type Parcel = {
  code: string;
  status: ParcelStatus;
  direction: "sent" | "received";
  items: ParcelItem[];
  createdAt: string;
  expiresAt: string;
  senderName?: string;
  recipientName?: string;
  deliveredAt?: string;
  deliveredLocationName?: string;
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
  "place",
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
export const SQUAD_NAME_MAX_LENGTH = 60;
export const ROLE_LABEL_MAX_LENGTH = 24;
export const RAID_NAME_MAX_LENGTH = 60;
/** Six squads of twenty is already more than an overlay can show. */
export const RAID_MAX_SQUADS = 6;

/**
 * The glyphs a role may wear, and nothing else — mirrored from the API, which
 * refuses anything outside this list.
 *
 * Each name is mapped to a Lucide component in
 * `src/components/squad/role-icon.tsx`; adding one means adding it there and in
 * the API's own copy too.
 *
 * Grouped the way the picker shows them: whoever is choosing is looking for a
 * shape, not reading an alphabet.
 */
export const ROLE_ICON_GROUPS = [
  {
    id: "combat",
    icons: [
      "crosshair",
      "target",
      "sword",
      "shield",
      "shield-half",
      "bomb",
      "flame",
      "zap",
      "skull",
    ],
  },
  {
    id: "vol",
    icons: [
      "navigation",
      "rocket",
      "plane",
      "compass",
      "anchor",
      "fuel",
      "gauge",
      "orbit",
    ],
  },
  {
    id: "soutien",
    icons: [
      "cross",
      "heart-pulse",
      "pill",
      "life-buoy",
      "battery",
      "users",
      "bell",
      "radio",
    ],
  },
  {
    id: "metier",
    icons: [
      "wrench",
      "hammer",
      "cog",
      "box",
      "truck",
      "hard-hat",
      "coins",
      "key",
    ],
  },
  {
    id: "reperes",
    icons: [
      "eye",
      "search",
      "map",
      "map-pin",
      "flag",
      "star",
      "hexagon",
      "triangle",
      "diamond",
      "ghost",
    ],
  },
] as const;

export type SquadRoleIcon = (typeof ROLE_ICON_GROUPS)[number]["icons"][number];

/**
 * A job inside the squad, worn by a member and shown as an icon left of their
 * name.
 *
 * Roles belong to the squad rather than to the player: everyone sees the same
 * «Boarder» with the same glyph, which is the whole point of having them.
 */
export type SquadRole = {
  id: string;
  label: string;
  icon: SquadRoleIcon;
  /**
   * One of the seven every squad starts with. Renameable and re-drawable, never
   * removable — the API refuses it.
   */
  base: boolean;
};

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
   * The id of one of the squad's `roles`, or `""` for none.
   *
   * Optional because the wire really can omit it: a squad created before roles
   * existed carries no such field. Absent reads as «none», and an id that
   * resolves to nothing is shown as «none» too rather than as a hole.
   */
  role?: string;
  /**
   * Commands the squad alongside the leader, with exactly the same powers —
   * appointing further lieutenants and handing the squad over included.
   *
   * Optional for the same reason as `role`: a squad created before the rank
   * existed carries no such field, and nothing between here and Mongo adds one.
   */
  lieutenant?: boolean;
};

/**
 * «Everybody, say you are ready»: the last one asked of a squad or a raid.
 *
 * Asking resets every member's `ready`; a member answers by setting their own
 * back. A client that sees an id it did not know raises the notification.
 */
export type ReadyCheck = {
  id: string;
  requestedAt: string;
  /** Who asked, by name. */
  requestedBy: string;
};

export type Squad = {
  id: string;
  name: string;
  /** Short, spoken out loud, shared to let others in. */
  code: string;
  leaderId: string;
  announcements: string;
  /**
   * When the announcements were last sent — every send, the same words
   * included, which is what « Renvoyer » is. Absent from a server older than
   * the feature, which leaves only the text to compare.
   */
  announcedAt?: string | null;
  members: SquadMember[];
  /** Absent from a squad older than the feature; read as the seven base ones. */
  roles?: SquadRole[];
  /** The raid this squad was linked into, or `null` when it runs alone. */
  raidId?: string | null;
  /** Absent from a server older than the feature. */
  readyCheck?: ReadyCheck | null;
  version: number;
  updatedAt: string;
};

/**
 * Several squads under one announcement.
 *
 * The raid holds no members of its own: its roster is `squads`, each keeping
 * its code, its leader and its roles. `leadSquadId` names the one that runs it —
 * whoever commands *that* squad renames the raid, writes its announcement and
 * unlinks the others.
 */
export type Raid = {
  id: string;
  name: string;
  code: string;
  announcement: string;
  /** As `Squad.announcedAt`, for the raid's announcement. */
  announcedAt?: string | null;
  leadSquadId: string;
  /** Absent from a server older than the feature. */
  readyCheck?: ReadyCheck | null;
  updatedAt: string;
  /** Longest-standing first, which is also the order the lead is handed down. */
  squads: Squad[];
};

/**
 * One of the squads the caller is in, as much of it as the switcher needs.
 *
 * A player is in one squad nearly always. A raid's organiser who opened the
 * raid's other squads — and leads each until somebody takes it over — is in
 * several, and this is how the overlay knows to offer them.
 */
export type SquadMembership = {
  id: string;
  name: string;
  code: string;
  raidId: string | null;
};

/**
 * What every squad route answers, and what the event stream pushes: where the
 * caller stands, in one object.
 *
 * `squad` is the one the request named with `?squad=`, or the longest-standing
 * membership when it named none. The raid rides along with it, so the overlay
 * draws every sub-squad from the one view it receives. `memberships` lists
 * every squad the caller is in, longest-standing first.
 */
export type SquadView = {
  squad: Squad | null;
  raid: Raid | null;
  memberships: SquadMembership[];
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
  role?: string;
  lieutenant?: boolean;
};

/* ------------------------------------------------------------------ */
/* Event stream                                                        */
/* ------------------------------------------------------------------ */

/**
 * Where the event stream Rust holds to the API stands. Mirrors `FeedStatus`
 * in `src-tauri/src/event_feed.rs`, string for string.
 *
 * - `idle`: no session, nothing to connect with;
 * - `polling`: the server has no stream to offer (it predates it), and the
 *   squad is read every few seconds while its overlay is up instead;
 * - `unauthorized`: the session was refused; stopped until it changes.
 */
export type FeedStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "polling"
  | "unauthorized";

/** Payload of `feed://status`. */
export type FeedStatusEvent = { status: FeedStatus };

/**
 * Payload of `squad://view`, and what `feed_snapshot` answers for the squad:
 * the view, and the squad it was asked for — `null` for the API's pick — so
 * it lands under the key it belongs to.
 */
export type SquadFeedView = {
  squad: string | null;
  id: string;
  view: SquadView;
};

/* ------------------------------------------------------------------ */
/* Plan de vol                                                         */
/* ------------------------------------------------------------------ */

/**
 * The briefing canvas, as the overlay reads it.
 *
 * Mirrors the read half of `nexus-tools/types/plan.ts` by hand, the way the
 * squad types are. Only the read half: the overlay follows a briefing and
 * shows the drawing, it does not compose one — so the caps, the patch shapes
 * and the draft a commit takes are deliberately absent, and a stroke kind
 * added there needs a line here only if it has to be *drawn*. A dash is drawn,
 * so it is mirrored — but it is never *chosen* here: the overlay carries one
 * pen and no picker.
 *
 * The split that matters is the same on both sides: the **feed** — names,
 * order, locks and a revision per phase — arrives on `plan://feed`, and the
 * strokes are pulled by delta against those revisions. A revision is published
 * an instant before the stroke carrying it exists, so a cursor is always the
 * highest revision actually *handed over*, never the one the feed announces.
 */

export const PLAN_GRID = 10_000;

export type PlanScope = "squad" | "raid";
export type DrawPolicy = "all" | "leaders";

export type StrokeKind =
  | "pen"
  | "line"
  | "arrow"
  | "rect"
  | "ellipse"
  | "text"
  | "token"
  | "pin";

export type PlanInk =
  | "squad"
  | "amber"
  | "red"
  | "green"
  | "sky"
  | "violet"
  | "white";

export type StrokeDash = "solid" | "dashed" | "dotted";

/** The kinds a dash is drawn on; a glyph in dots reads as a rendering fault. */
export const DASHED_KINDS: readonly StrokeKind[] = [
  "pen",
  "line",
  "arrow",
  "rect",
  "ellipse",
];

export type PlanPresenter = {
  userId: string;
  name: string;
  phaseId: string;
  startedAt: string;
};

export type PlanPhaseSummary = {
  id: string;
  order: number;
  name: string;
  durationSec: number;
  locked: boolean;
  rev: number;
  epoch: number;
  strokes: number;
};

export type PlanSummary = {
  id: string;
  scope: PlanScope;
  ownerId: string;
  name: string;
  backgroundUrl: string | null;
  backgroundW: number;
  backgroundH: number;
  drawPolicy: DrawPolicy;
  presenter: PlanPresenter | null;
  archivedAt: string | null;
  version: number;
  updatedAt: string;
  phases: PlanPhaseSummary[];
};

export type PlanAssignment = { userId: string; name: string; task: string };

export type PlanPhase = PlanPhaseSummary & {
  objective: string;
  points: string[];
  abort: string;
  assignments: PlanAssignment[];
};

export type Plan = Omit<PlanSummary, "phases"> & { phases: PlanPhase[] };

export type PlanStroke = {
  id: string;
  phaseId: string;
  epoch: number;
  rev: number;
  clientId: string;
  authorId: string;
  authorName: string;
  squadId: string;
  kind: StrokeKind;
  ink: PlanInk;
  width: number;
  /** Solid on anything the site drew before dashes existed. */
  dash: StrokeDash;
  points: number[];
  text: string;
  tokenUserId: string;
  deletedAt: string | null;
  createdAt: string;
};

export type StrokeDelta = {
  phaseId: string;
  epoch: number;
  rev: number;
  strokes: PlanStroke[];
};

export type PlanFeed = {
  scope: PlanScope;
  ownerId: string | null;
  plans: PlanSummary[];
};

export type PlanView = { feed: PlanFeed; plan: Plan | null };

/** Payload of `plan://feed`, and what `feed_snapshot` answers for `plan`. */
export type PlanFeedEvent = {
  squad: string | null;
  id: string;
  view: PlanFeed;
};

/**
 * When a phase starts, counted from the top of the operation. Durations chain:
 * correcting one step moves every later T+ with it.
 */
export function phaseStartSec(
  phases: readonly { id: string; durationSec: number }[],
  phaseId: string,
): number {
  let total = 0;

  for (const phase of phases) {
    if (phase.id === phaseId) break;
    total += phase.durationSec;
  }

  return total;
}

/** `T+06:00`, and `T+1:04:00` once an operation runs past the hour. */
export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60) % 60;
  const hours = Math.floor(safe / 3600);
  const rest = safe % 60;

  const pad = (value: number) => value.toString().padStart(2, "0");

  return hours > 0
    ? `T+${hours}:${pad(minutes)}:${pad(rest)}`
    : `T+${pad(minutes)}:${pad(rest)}`;
}

/** Phases as the plan reads, whatever order the document stored them in. */
export function inPlanOrder<T extends { order: number }>(phases: T[]): T[] {
  return [...phases].sort((a, b) => a.order - b.order);
}

// ─── Lieux ────────────────────────────────────────────────────────────────────

/**
 * Le catalogue des lieux du 'verse, tel que le site le sert.
 *
 * Attention au mot : sur le site, le relevé d'un lieu s'appelle un **plan**.
 * Ici, « plan » est déjà pris par le plan de vol d'une escouade — un canevas
 * de traits, pas une image. Côté application on parle donc de **carte**, et la
 * frontière est nette : `PlacePlan` est ce que l'API renvoie, `carte` est ce
 * que l'interface montre.
 */
export const PLACE_TYPES = [
  "star",
  "planet",
  "moon",
  "city",
  "station",
  "outpost",
  "spaceport",
  "district",
  "building",
  "shop",
] as const;

export type PlaceType = (typeof PLACE_TYPES)[number];

export const PLACE_SERVICES = [
  "asop",
  "restock",
  "medical",
  "armory",
  "cargo",
  "refinery",
  "rental",
  "habitation",
  "crafting",
  "missions",
  "transit",
  "hangar",
] as const;

export type PlaceService = (typeof PLACE_SERVICES)[number];

export function isPlaceService(value: string): value is PlaceService {
  return (PLACE_SERVICES as readonly string[]).includes(value);
}

/**
 * Un repère posé sur une carte : un service, un autre lieu, ou un symbole — ce
 * dernier pour ce qui n'est ni l'un ni l'autre : une caisse à fouiller, une
 * caméra, une clé de sécurité.
 *
 * Le site n'en garde qu'un des trois par repère, et rejette celui qui n'en a
 * aucun. **Ce type ne l'exprime pas, et c'est voulu** : il décrit ce qui arrive
 * par l'API, pas ce que l'API promet. Une union fermée le rendrait plus strict
 * que sa source et refuserait la première réponse un peu inattendue, là où un
 * champ de trop se lit sans rien casser. L'exclusivité se vérifie donc à
 * l'écriture, côté site, jamais ici — le code de lecture ci-dessous prend les
 * trois cas dans l'ordre, et a un dernier recours.
 *
 * Le miroir s'arrête au champ. L'app ne dessine pas les symboles : sa copie du
 * modèle est partielle à dessein — elle porte l'emprise et l'aperçu, pas la
 * géométrie — et y porter la table des tracés la ferait diverger du site sans
 * rien apporter. Un repère à symbole s'y affiche donc comme il le faisait
 * jusqu'ici, sous son étiquette.
 *
 * Sa couleur n'est pas stockée : elle se déduit du type du lieu visé, et
 * retombe sur la teinte neutre pour tout le reste — un service, un symbole, ou
 * un lieu que la page n'a pas chargé.
 */
export type PlacePlanMarker = {
  id: string;
  /** Fraction de l'image, origine en haut à gauche. Entre 0 et 1. */
  x: number;
  y: number;
  service?: PlaceService;
  targetSlug?: string;
  /** Le nom du dessin, quand le repère ne désigne ni service ni lieu. */
  glyph?: string;
  label?: string;
  note?: string;
};

export type PlacePlanOrigin = { slug: string; name: string; planId: string };

/**
 * Une carte, et ses deux natures — miroir de `types/places.ts` côté site.
 *
 * Une carte **image** est un relevé téléversé ; une carte **dessinée** est une
 * géométrie relevée pièce par pièce dans le back-office, pour les lieux dont
 * personne n'a jamais publié de plan.
 *
 * L'overlay ne dessine pas de géométrie : il affiche l'aperçu rastérisé que le
 * site produit à l'enregistrement. D'où `planImage()`, qui rend l'image d'une
 * carte quelle que soit sa nature — et `null` pour un relevé dessiné dont
 * l'aperçu n'a pas encore abouti, cas où il n'y a rien à montrer plutôt qu'une
 * image cassée.
 */
type PlacePlanBase = {
  id: string;
  name: string;
  note?: string;
  markers: PlacePlanMarker[];
  /** Présent quand le lieu emprunte cette carte à un voisin. */
  borrowedFrom?: PlacePlanOrigin;
};

export type ImagePlacePlan = PlacePlanBase & {
  /** Absent sur les cartes écrites avant les relevés dessinés : c'est une image. */
  kind?: "image";
  imageUrl: string;
  /** Taille naturelle de l'image : elle donne le rapport d'aspect du cadre. */
  imageWidth: number;
  imageHeight: number;
};

export type PlanPreview = { url: string; width: number; height: number };

/**
 * Miroir partiel, comme celui du plan de vol : seulement de quoi *afficher*.
 *
 * L'emprise et les niveaux sont là parce que le cadre en a besoin quand
 * l'aperçu manque ; la géométrie des pièces, elle, ne l'est pas — l'overlay ne
 * la dessine pas, et la recopier obligerait à la tenir à jour pour rien.
 */
export type DrawnPlacePlan = PlacePlanBase & {
  kind: "drawn";
  widthCm: number;
  heightCm: number;
  preview?: PlanPreview;
};

export type PlacePlan = ImagePlacePlan | DrawnPlacePlan;

export function isDrawnPlan(plan: PlacePlan): plan is DrawnPlacePlan {
  return (
    plan.kind === "drawn" &&
    // L'emprise donne ses proportions au cadre quand l'aperçu manque : absente,
    // elle rend un `aspectRatio` de `NaN / NaN` et le cadre s'effondre.
    Number.isFinite(plan.widthCm) &&
    plan.widthCm > 0 &&
    Number.isFinite(plan.heightCm) &&
    plan.heightCm > 0
  );
}

/** L'image d'une carte, quelle que soit sa nature — ou rien. */
export function planImage(plan: PlacePlan): PlanPreview | null {
  if (isDrawnPlan(plan)) return plan.preview ?? null;
  return plan.imageUrl
    ? { url: plan.imageUrl, width: plan.imageWidth, height: plan.imageHeight }
    : null;
}

export type PlaceSummary = {
  id: string;
  slug: string;
  name: string;
  type: PlaceType;
  imageUrl?: string;
  services?: PlaceService[];
  shopCategory?: string;
  parentSlug?: string;
  parentName?: string;
  depth?: number;
  systemSlug?: string;
  systemName?: string;
  bodySlug?: string;
  bodyName?: string;
  childCount?: number;
  shopCount?: number;
  planCount?: number;
};

export type PlaceAncestor = { slug: string; name: string; type: PlaceType };

export type PlaceDetails = PlaceSummary & {
  description?: string;
  plans?: PlacePlan[];
  /** De la racine au parent direct, dans cet ordre. */
  ancestors: PlaceAncestor[];
  children: PlaceSummary[];
  /** Les magasins de tout le sous-arbre, pas seulement les enfants directs. */
  shops: PlaceSummary[];
  /** Les lieux que les repères ouvrent, résolus une fois pour toutes. */
  planTargets: PlaceSummary[];
  /** Où le lieu se trouve en jeu, quand un joueur l'a relevé (NPS). */
  position?: PlacePosition;
};

export type PlaceListResponse = {
  places: PlaceSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type PlaceFacetCount = { value: string; count: number };

export type PlaceFacets = {
  types: PlaceFacetCount[];
  systems: { slug: string; name: string }[];
  bodies: { slug: string; name: string; systemSlug?: string }[];
  services: PlaceFacetCount[];
};

/** Ce que l'overlay demande : la carte d'un lieu, et de quoi la lire. */
export type PlacePlansResponse = {
  slug: string;
  name: string;
  type: PlaceType;
  ancestorSlugs: string[];
  ancestors: PlaceAncestor[];
  plans: PlacePlan[];
  targets: PlaceSummary[];
};

/* ------------------------------------------------------------------ */
/* Presence                                                            */
/* ------------------------------------------------------------------ */

/**
 * Whether one is playing, self-declared, and doing what — mirrors
 * `types/presence.ts` on Nexus Tools. A declaration lapses on its own after
 * `PRESENCE_TTL_HOURS`; this app renews it for as long as it runs.
 */
export const PRESENCE_ACTIVITY_MAX_LENGTH = 80;

export const PRESENCE_ACTIVITY_SUGGESTIONS = [
  "mining",
  "trading",
  "hauling",
  "bountyHunting",
  "combat",
  "exploration",
  "salvage",
  "industry",
  "missions",
  "racing",
  "social",
] as const;

/**
 * A planned session stays shown until an hour past its time: someone running
 * late is still «prévu», not «hors jeu».
 */
export const PLANNED_SESSION_GRACE_HOURS = 1;

/** The organization event a planned session picks up. */
export type PlannedEventRef = {
  orgId: string;
  eventId: string;
  title: string;
};

/**
 * One's next session: when, and to do what. One per person; planning another
 * replaces it. It goes away an hour past its time, or when one starts playing
 * — its activity then becomes the session's.
 */
export type PlannedSession = {
  /** ISO. */
  at: string;
  activity: string | null;
  /** Never set in what friends see: a private event is the org's business. */
  event: PlannedEventRef | null;
};

/**
 * `planned` is optional here, and every reader treats `undefined` as `null`:
 * a site deployed before planned sessions existed answers without it.
 */
export type MyPresence = {
  playing: boolean;
  activity: string | null;
  since: string | null;
  expiresAt: string | null;
  /** The next session, playing or not; `null` when none is planned. */
  planned?: PlannedSession | null;
};

export type MemberPresence = {
  userId: string;
  name: string;
  avatar: string | null;
  rank: string | null;
  activity: string | null;
  since: string;
};

/** A member who planned a session and is not playing yet. */
export type MemberPlanned = {
  userId: string;
  name: string;
  avatar: string | null;
  rank: string | null;
  planned: PlannedSession;
};

export type OrgPresence = {
  orgId: string;
  playing: MemberPresence[];
  /**
   * Those not playing who planned a session, soonest first. `event` is only
   * set for an event of this organization. Absent from an older site.
   */
  planned?: MemberPlanned[];
  memberCount: number;
};

/* ------------------------------------------------------------------ */
/* Organization events                                                 */
/* ------------------------------------------------------------------ */

/**
 * Mirrors `types/org-events.ts` on Nexus Tools: a member plans an outing in
 * the organization's calendar, the others register to it — with a role, from
 * the same glyphs as squad roles, and answers to free questions.
 *
 * Withdrawing deletes nothing: the registration stays, marked `withdrawn`,
 * and no longer counts. Registering again brings it back.
 *
 * «Évènement» as in a calendar: nothing to do with the event stream below.
 */

export const ORG_EVENT_ANSWER_MAX_LENGTH = 1000;

/** `private`: members only, the default. `public`: anyone reads it. */
export type OrgEventVisibility = "private" | "public";

export type OrgEventRole = {
  /** Opaque and stable: renaming a role changes nothing for who picked it. */
  id: string;
  label: string;
  icon: SquadRoleIcon;
  /** How many the organizer would like, `null` for no target. Not a cap. */
  wanted: number | null;
};

export type OrgEventQuestion = {
  id: string;
  label: string;
  required: boolean;
};

export type OrgEventRegistration = {
  userId: string;
  name: string;
  /** One of the event's role ids, or `""` for none. */
  role: string;
  /** By question id; an unanswered question is absent. */
  answers: Record<string, string>;
  /** Kept, but out of every count. */
  withdrawn: boolean;
  registeredAt: string;
  updatedAt: string;
};

/** A registrant as members see them: without their answers. */
export type OrgEventParticipant = {
  userId: string;
  name: string;
  role: string;
};

/** An event as one reader sees it, with what that reader may do with it. */
export type OrgEventView = {
  id: string;
  orgId: string;
  title: string;
  description: string;
  /** ISO. */
  startsAt: string;
  /** ISO, after `startsAt`. */
  endsAt: string;
  /** Free text: «Hangar 03 de Lorville», «QT vers Nyx». */
  meetingPoint: string;
  meetingPlace: { slug: string; name: string } | null;
  visibility: OrgEventVisibility;
  roles: OrgEventRole[];
  questions: OrgEventQuestion[];
  createdBy: { userId: string; name: string };
  /** The squad built from the event, `null` until there is one. */
  squadId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Active registrations, withdrawn ones excluded. */
  registrationCount: number;
  /** Active registrations by role id, `""` for those without one. */
  roleCounts: Record<string, number>;
  /** Active registrants, for members; empty for a visitor of a public event. */
  participants: OrgEventParticipant[];
  /** The reader's registration, withdrawn included; `null` without one. */
  myRegistration: OrgEventRegistration | null;
  /** A member of the organization: may register. */
  canRegister: boolean;
  /** Its creator or an editor of the organization. */
  canManage: boolean;
};

export type OrgEventList = { events: OrgEventView[] };

/** What a member sends to register, or to change their registration. */
export type OrgEventRegistrationInput = {
  role?: string;
  answers?: Record<string, string>;
};

/** What building the event's squad answers. */
export type OrgEventSquadResult = {
  event: OrgEventView;
  squad: { id: string; name: string; code: string };
  /** Past twenty registrants, several squads under one raid. */
  squadCount: number;
  /** Those who found no room: a raid holds at most six squads. */
  leftOut: number;
};

/** An upcoming event the reader is registered to: a planned session to pick. */
export type MyUpcomingEvent = {
  orgId: string;
  orgName: string;
  eventId: string;
  title: string;
  startsAt: string;
  endsAt: string;
};

/* ------------------------------------------------------------------ */
/* Friends                                                             */
/* ------------------------------------------------------------------ */

/**
 * Mirrors `types/friends.ts` on Nexus Tools. A friendship is mutual and born
 * of a single-use code: one hands it out, the other types it in, and the code
 * is gone.
 */
export type Friend = {
  userId: string;
  name: string;
  avatar: string | null;
  /**
   * The organization shown with their name: the one they chose in their
   * profile, else the first one the reader shares with them, if any.
   */
  sharedOrg: string | null;
  friendsSince: string;
  /** What they declared, `null` when they are not playing. */
  playing: { activity: string | null; since: string } | null;
  /**
   * Their next session when they are not playing, `null` otherwise — and
   * absent from an older site. `event` is always `null` here.
   */
  planned?: PlannedSession | null;
};

export type FriendList = { friends: Friend[] };

/** The reader's pending code; `null` when none was asked for, or it was used. */
export type MyFriendCode = { code: string | null };

/** One of the reader's organizations, as the display choice lists it. */
export type DisplayOrgOption = {
  id: string;
  name: string;
  tag: string | null;
  image: string | null;
};

/**
 * Mirrors `types/display-org.ts` on Nexus Tools: the organization the reader
 * shows with their name, in others' friend lists. `orgId` is `null` without a
 * choice, or once the chosen one was left: each friend then sees the first
 * organization they share.
 */
export type MyDisplayOrg = {
  orgId: string | null;
  organizations: DisplayOrgOption[];
};

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

/**
 * Mirrors `types/reports.ts` on Nexus Tools and `POST /api/reports`: a
 * player flags a place, an item, an image, a map or an organization. The
 * site keeps one case per target; a moderator decides, and an upheld report
 * earns its reporter points.
 */
export type ReportTargetType = "place" | "placeMedia" | "plan" | "item" | "org";

export const REPORT_REASONS = [
  "wrong",
  "outdated",
  "duplicate",
  "media",
  "offensive",
  "copyright",
  "spam",
  "other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

/* Their wording is the site's report form (`Reports.reasons`), in the
   `Report.reasons` messages. */

/** `other` needs a comment; the site cuts it at 500 characters. */
export const MAX_REPORT_COMMENT_LENGTH = 500;

/** What an upheld report earns its reporter. */
export const REPORT_UPHELD_POINTS = 1;

export type ReportInput = {
  /** `id` is a slug for a place or an item, `slug:planId` for a map. */
  target: { type: ReportTargetType; id: string };
  reason: ReportReason;
  comment?: string;
};

export type SubmitReportResult = {
  id: string;
  status: "open" | "resolved" | "dismissed";
  /** Players who reported this target, the reader included. */
  reporters: number;
};

/* ------------------------------------------------------------------ */
/* Contributions: level, achievements, events                          */
/* ------------------------------------------------------------------ */

/**
 * Mirrors `ContribEvent` in `types/gamification.ts` on Nexus Tools: what
 * happened to the reader's contributions since the last read, each one a
 * desktop notification.
 */
export type ContribEvent =
  | {
      type: "published";
      at: string;
      kind: string;
      name: string;
      points: number;
    }
  | {
      type: "changesRequested";
      at: string;
      kind: string;
      name: string;
      message?: string;
    }
  | { type: "achievement"; at: string; id: string; title: string }
  | { type: "level"; at: string; level: number; title: string };

/**
 * `GET /api/me/contrib`: the reader's points, level and unlocked achievements,
 * labels already in French, and the events after `since`.
 */
export type ContribSummary = {
  points: number;
  level: number;
  levelKey: string;
  levelName: string;
  nextLevelPoints?: number;
  nextLevelName?: string;
  acceptanceRate?: number;
  achievements: { id: string; title: string; at?: string }[];
  events: ContribEvent[];
  /** To send back as `since` on the next read. */
  now: string;
};

/* ------------------------------------------------------------------ */
/* Contributions from the app: place images, price confirmations       */
/* ------------------------------------------------------------------ */

/**
 * The reader's standing as the site answers it after a contribution: what
 * `standing` holds in the responses below.
 */
export type ContributorStanding = {
  points: number;
  level: number;
  levelKey: string;
  nextLevelPoints?: number;
  /** Contributions of the reader waiting for a review. */
  pending: number;
  /** ISO date, while a moderator has suspended the reader's contributions. */
  suspendedUntil?: string;
};

/** A contribution as `POST /api/lieux/{slug}/media` answers it. */
export type Contribution = {
  id: string;
  kind: string;
  /** `published` straight away from level 2, `pending` a review before. */
  status: "published" | "pending" | (string & {});
  /** Earned on publication. */
  points: number;
  target: { type: string; slug: string; name: string };
};

/** `POST /api/lieux/{slug}/media`, 201. */
export type PlaceMediaUploadResult = {
  contribution: Contribution;
  standing: ContributorStanding;
};

/** An image of a place: 2 points, 3 more for the place's first one. */
export const PLACE_MEDIA_POINTS = 2;
export const PLACE_FIRST_MEDIA_BONUS = 3;
export const MAX_MEDIA_CAPTION_LENGTH = 140;
export const MAX_MEDIA_CREDIT_LENGTH = 60;

/** `POST /api/confirmations`: « still accurate », or not, with a word why. */
export type ConfirmationInput = {
  target: { type: "item"; slug: string };
  subject: "prices";
  accurate: boolean;
  comment?: string;
};

/** `POST /api/confirmations`, 201. */
export type ConfirmationResult = {
  /** `points` is 0 past the daily allowance of confirmations. */
  confirmation: { points: number; at: string };
  standing: ContributorStanding;
  /** True when this « no longer accurate » opened a report. */
  reported: boolean;
};

/** What a confirmation earns, as long as the daily allowance lasts. */
export const CONFIRMATION_POINTS = 1;
export const MAX_CONFIRMATION_COMMENT_LENGTH = 300;

/* ------------------------------------------------------------------ */
/* NPS — Nexus Positioning System                                      */
/* ------------------------------------------------------------------ */

/**
 * Where a place is in game, in metres, as the site stores it.
 *
 * On a body that turns (`body`, the slug of a place carrying celestial
 * parameters) it is in that body's frame, rotation undone, where it does not
 * move. In space (`body` absent) it is in the frame of the star system.
 */
export type PlacePosition = {
  body?: string;
  x: number;
  y: number;
  z: number;
};

/** A planet or a moon, with what the NPS needs to find one's way on it. */
export type NpsBody = {
  slug: string;
  name: string;
  systemSlug?: string;
  systemName?: string;
  /** The centre, in metres, in the frame of the star system. */
  x: number;
  y: number;
  z: number;
  /** The ground's radius, in metres. */
  radius: number;
  /** How far from the centre, in metres, its frame turns with it. */
  zoneRadius: number;
  /** Hours for one turn on itself; 0 when it does not turn. */
  rotationHours: number;
  /** Its rotation on 2020-01-01T00:00:00Z, in degrees. */
  rotationAdjust: number;
};

/** A place whose position players have recorded. */
export type NpsPlace = {
  slug: string;
  name: string;
  type: PlaceType;
  /** Each system has its own frame: a position means nothing in another. */
  systemSlug?: string;
  systemName?: string;
  bodyName?: string;
  parentName?: string;
  position: PlacePosition;
};

/** `GET /api/lieux/nps`. */
export type NpsResponse = {
  bodies: NpsBody[];
  places: NpsPlace[];
};

/** `POST /api/lieux/{slug}/position`, 201. */
export type PlacePositionResult = {
  contribution: Contribution;
  standing: ContributorStanding;
};

/* ------------------------------------------------------------------ */
/* Marketplace orders (`GET /api/me/orders`)                           */
/* ------------------------------------------------------------------ */

export type OrderStatus =
  | "PENDING"
  | "QUOTED"
  | "CONFIRMED"
  | "ACCEPTED"
  | "READY"
  | "DELIVERED"
  | "REFUSED"
  | "CANCELLED";

/** An order as the app lists it: placed by the reader, or received by a shop. */
export type AppOrder = {
  id: string;
  shopId: string;
  shopName: string;
  buyerName: string;
  kind: "DIRECT" | "CUSTOM";
  /** «3 × M5A Cannon», or the message of a custom request. */
  summary: string;
  status: OrderStatus;
  total?: number;
  pickup?: string;
  createdAt: string;
  updatedAt: string;
  /** The order's page on the site, the buyer's or the shop's. */
  path: string;
};

/** An order received by a shop, or a step taken by the other party. */
export type AppOrderEvent = {
  orderId: string;
  side: "placed" | "received";
  type: "new" | "status" | "quote";
  status: OrderStatus;
  quote?: number;
  shopName: string;
  buyerName: string;
  summary: string;
  pickup?: string;
  at: string;
  path: string;
};

export type AppOrdersSummary = {
  placed: AppOrder[];
  /** The shops the reader sells for, to sort the orders they receive. */
  shops: { id: string; name: string }[];
  received: AppOrder[];
  /** Empty without `since`: the first read only sets the mark. */
  events: AppOrderEvent[];
  now: string;
};
