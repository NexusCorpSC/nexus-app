import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/locale";
import type { Messages } from "@/i18n/messages-types";

/**
 * Every text of the app, one JSON file per namespace and per language:
 * `messages/<locale>/<Namespace>.json`. The file name is the namespace that
 * `useTranslations` takes.
 *
 * French is the reference. A key missing in another language falls back on
 * its French text rather than on the bare key.
 */

const files = import.meta.glob<Record<string, unknown>>("./messages/*/*.json", {
  eager: true,
  import: "default",
});

type Tree = { [key: string]: Tree | string };

function byLocale(locale: Locale): Tree {
  const tree: Tree = {};
  for (const [path, content] of Object.entries(files)) {
    const match = /\.\/messages\/([^/]+)\/([^/]+)\.json$/.exec(path);
    if (match && match[1] === locale) tree[match[2]] = content as Tree;
  }
  return tree;
}

function withFallback(messages: Tree, fallback: Tree): Tree {
  const merged: Tree = { ...fallback };
  for (const [key, value] of Object.entries(messages)) {
    const base = fallback[key];
    merged[key] =
      typeof value === "object" && typeof base === "object"
        ? withFallback(value, base)
        : value;
  }
  return merged;
}

const reference = byLocale(DEFAULT_LOCALE);

export const MESSAGES = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    locale === DEFAULT_LOCALE ? reference : withFallback(byLocale(locale), reference),
  ]),
) as unknown as Record<Locale, Messages>;
