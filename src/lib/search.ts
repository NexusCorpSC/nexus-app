import { openUrl } from "@tauri-apps/plugin-opener";
import { openMainRoute } from "@/lib/main-window";
import { getApiBaseUrl } from "@/lib/settings";
import type { SearchResult, SearchType } from "@/types/nexus";

/** What each kind of result is called in the palette. */
export const SEARCH_TYPE_LABELS: Record<SearchType, string> = {
  blueprint: "Blueprint",
  mission: "Mission",
  faction: "Faction",
  shopItem: "Article",
  shop: "Boutique",
  organization: "Organisation",
  cargoShip: "Cargo",
  inventoryItem: "Inventaire",
};

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
  // `[^/]` keeps `/missions/factions/<id>` out: a faction is not a mission,
  // and this app has no screen for one.
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
