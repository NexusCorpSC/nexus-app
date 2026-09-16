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
    label: "Combat",
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
    label: "Vol",
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
    label: "Soutien",
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
    label: "Métier",
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
    label: "Repères",
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

export const PLACE_TYPE_LABELS: Record<PlaceType, string> = {
  star: "Système",
  planet: "Planète",
  moon: "Lune",
  city: "Ville",
  station: "Station",
  outpost: "Avant-poste",
  spaceport: "Spatioport",
  district: "Quartier",
  building: "Bâtiment",
  shop: "Magasin",
};

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

export const PLACE_SERVICE_LABELS: Record<PlaceService, string> = {
  asop: "Terminal ASOP",
  restock: "Réapprovisionnement",
  medical: "Médical",
  armory: "Armurerie",
  cargo: "Fret",
  refinery: "Raffinerie",
  rental: "Location",
  habitation: "Habitation",
  crafting: "Fabrication",
  missions: "Missions",
  transit: "Transit",
  hangar: "Hangar",
};

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
