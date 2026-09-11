import { openUrl } from "@tauri-apps/plugin-opener";
import { openMainRoute } from "@/lib/main-window";
import { getApiBaseUrl } from "@/lib/settings";
import {
  ITEM_KIND_LABELS,
  type ItemKind,
  type SearchResult,
  type SearchType,
} from "@/types/nexus";

/** What each kind of result is called in the palette. */
export const SEARCH_TYPE_LABELS: Record<SearchType, string> = {
  blueprint: "Blueprint",
  item: "Objet",
  mission: "Mission",
  faction: "Faction",
  shopItem: "Article",
  shop: "Boutique",
  organization: "Organisation",
  cargoShip: "Cargo",
  inventoryItem: "Inventaire",
};

/**
 * What to call one result. An in-game object says which kind it is — a
 * weapon or a ship reads better as such than as a bare «Objet».
 */
export function searchResultLabel(result: SearchResult): string {
  if (result.type === "item") {
    const kind = result.meta?.kind;
    if (typeof kind === "string" && kind in ITEM_KIND_LABELS) {
      return ITEM_KIND_LABELS[kind as ItemKind];
    }
  }
  return SEARCH_TYPE_LABELS[result.type];
}

/**
 * Website paths this application has a screen of its own for.
 *
 * The API answers with the URL of the **web** page, which is the right answer
 * for a browser and only sometimes for us: the desktop client covers a subset
 * of the site. Anything missing from this table opens in the browser rather
 * than landing on a route that does not exist — which the router would
 * silently turn into the blueprint list.
 */
const DESKTOP_SCREENS: { pattern: RegExp; route: (id: string) => string }[] = [
  {
    pattern: /^\/crafting\/blueprints\/([^/?#]+)$/,
    route: (slug) => `/blueprints/${slug}`,
  },
  {
    pattern: /^\/items\/([^/?#]+)$/,
    route: (slug) => `/items/${slug}`,
  },
  // Before the missions, and `[^/]` in that one, because
  // `/missions/factions/<id>` is a faction and not a mission.
  {
    pattern: /^\/missions\/factions\/([^/?#]+)$/,
    route: (id) => `/factions/${id}`,
  },
  {
    pattern: /^\/missions\/([^/?#]+)$/,
    route: (id) => `/missions/${id}`,
  },
  {
    pattern: /^\/inventory$/,
    route: () => "/inventory",
  },
];

/** The screen showing `url` here, or `null` when only the website has one. */
export function desktopRoute(url: string): string | null {
  for (const { pattern, route } of DESKTOP_SCREENS) {
    const match = url.match(pattern);
    if (match) return route(match[1] ?? "");
  }

  return null;
}

/** Whether picking this result leaves the application. */
export function opensInBrowser(result: SearchResult): boolean {
  return desktopRoute(result.url) === null;
}

/**
 * Shows the result: in the main window when this app has the screen for it,
 * in the browser otherwise.
 */
export async function openSearchResult(result: SearchResult): Promise<void> {
  const route = desktopRoute(result.url);

  if (route) {
    await openMainRoute(route);
    return;
  }

  // The site the results came from, which is also the one the user configured.
  const baseUrl = await getApiBaseUrl();
  await openUrl(`${baseUrl}${result.url}`);
}
