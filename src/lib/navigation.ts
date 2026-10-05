/**
 * What the app remembers of where the reader has been, so a "back" link can
 * return to the real previous screen and a list opens again with the filters
 * it was left with.
 *
 * The router keeps no readable history, so the tracker mirrors it: one entry
 * per history slot, with the cursor following pushes, replaces and pops.
 */

type Entry = { key: string; path: string };

const entries: Entry[] = [];
let cursor = -1;

export function recordNavigation(action: string, key: string, path: string) {
  // Called while rendering, so the same location can come in more than once.
  if (entries[cursor]?.key === key) {
    entries[cursor].path = path;
    return;
  }

  if (action === "PUSH" || cursor < 0) {
    entries.splice(cursor + 1);
    entries.push({ key, path });
    cursor = entries.length - 1;
    return;
  }

  if (action === "REPLACE") {
    entries[cursor] = { key, path };
    return;
  }

  // Going back or forward: the slot is one we already saw, unless the app
  // started on it (a reload keeps the browser history but not this copy).
  const index = entries.findIndex((entry) => entry.key === key);
  if (index >= 0) {
    cursor = index;
    entries[index] = { key, path };
  } else {
    entries.splice(0, entries.length, { key, path });
    cursor = 0;
  }
}

/** The screen before this one in the app's history, if there is one. */
export function previousPath(): string | null {
  return cursor > 0 ? entries[cursor - 1].path : null;
}

const lastListUrls = new Map<string, string>();

/** Remembers a list as last seen, filters included. */
export function rememberListUrl(pathname: string, search: string) {
  lastListUrls.set(pathname, search ? `${pathname}?${search}` : pathname);
}

/** The list at `pathname` as last seen, or the bare list. */
export function lastListUrl(pathname: string): string {
  return lastListUrls.get(pathname) ?? pathname;
}
