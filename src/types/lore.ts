/**
 * Le lore du 'Verse servi par le site (`/api/lore`) : les articles de la
 * Galactapedia et la starmap de RSI, en anglais comme la source.
 */

export type LoreArticleSummary = {
  id: string;
  title: string;
  type?: string;
  categories: string[];
  excerpt: string;
  rsiUrl: string;
  thumbnailUrl?: string;
};

export type LoreCategory = { name: string; count: number };

export type LorePage = {
  results: LoreArticleSummary[];
  total: number;
  page: number;
  pageSize: number;
  categories: LoreCategory[];
};

export type StarmapSensor = {
  population: number;
  economy: number;
  danger: number;
};

export type LoreArticle = {
  wikiId: string;
  title: string;
  type?: string;
  categories: string[];
  tags: string[];
  thumbnailUrl?: string;
  /** Markdown, avec des liens vers d'autres articles sur le site de RSI. */
  body: string;
  rsiUrl: string;
  removedAt?: string;
  /** Les articles cités qui sont en base. */
  linked: { id: string; title: string }[];
  starmap: {
    code: string;
    kind: "system" | "body";
    name: string;
    systemCode: string;
    placeSlug?: string;
  }[];
};

export type StarmapEntry = {
  code: string;
  name: string;
  designation?: string;
  type: string;
  subType?: string;
  status?: string;
  description?: string;
  affiliations: string[];
  sensor?: StarmapSensor;
  habitable?: boolean;
  placeSlug?: string;
  articleId?: string;
};

export type StarSystemSummary = Pick<
  StarmapEntry,
  "code" | "name" | "status" | "affiliations" | "placeSlug"
>;

export type StarSystem = StarmapEntry & {
  jumpPoints?: { to: string; toName?: string; size?: string }[];
  article?: LoreArticleSummary;
  bodies: (StarmapEntry & { articleTitle?: string })[];
};

/** Le lore d'un lieu du catalogue, joint à sa fiche par `/api/lieux/<slug>`. */
export type PlaceLore = {
  starmap?: Pick<
    StarmapEntry,
    | "code"
    | "designation"
    | "subType"
    | "description"
    | "affiliations"
    | "sensor"
  >;
  article?: LoreArticleSummary;
};
