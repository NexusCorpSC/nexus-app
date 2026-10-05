/**
 * The languages the app speaks, and the one it speaks right now.
 *
 * The active locale is also kept here, outside React, for the formatting
 * helpers that run without a component around them (`formatDate`, the
 * planned-session wording…). The provider sets it before rendering anything,
 * and remounts the whole tree when it changes, so a helper called during
 * render always reads the language on screen.
 */

export const LOCALES = ["fr", "en", "es"] as const;

export type Locale = (typeof LOCALES)[number];

/** What the app falls back on, for a system language it does not speak. */
export const DEFAULT_LOCALE: Locale = "fr";

/** Each language named in itself, as a language picker shows it. */
export const LOCALE_NAMES: Record<Locale, string> = {
  fr: "Français",
  en: "English",
  es: "Español",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * The first language of the system the app speaks: `es-MX` gives `es`.
 * French when none of them is one of ours.
 */
export function detectSystemLocale(): Locale {
  const candidates =
    typeof navigator === "undefined"
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language];

  for (const tag of candidates) {
    const language = tag?.toLowerCase().split("-")[0];
    if (isLocale(language)) return language;
  }
  return DEFAULT_LOCALE;
}

let active: Locale = DEFAULT_LOCALE;

/** The language on screen. Read it at call time, never at module load. */
export function getLocale(): Locale {
  return active;
}

export function setActiveLocale(locale: Locale): void {
  active = locale;
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
}
