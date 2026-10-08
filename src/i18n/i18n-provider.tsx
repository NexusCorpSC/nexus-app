import { useEffect, useState, type ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isLocale, setActiveLocale, type Locale } from "@/i18n/locale";
import { MESSAGES } from "@/i18n/messages";
import { translator } from "@/i18n/translate";
import { getLocaleSetting, setLocaleSetting } from "@/lib/settings";

/** Tells every open window that the language changed. */
const LOCALE_EVENT = "settings://locale";

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Changes the language of the app, in every window at once: each overlay is
 * its own webview, created at startup, that would otherwise keep the language
 * it was opened in until the next launch.
 */
export async function changeLocale(locale: Locale): Promise<void> {
  await setLocaleSetting(locale);
  await emit(LOCALE_EVENT, locale);
}

/**
 * Hands the tray menu and the native notifications their texts. Only the
 * main window does it, so that one change does not send it ten times.
 */
function relabelNative() {
  if (getCurrentWindow().label !== "main") return;
  const t = translator("Native");
  void invoke("set_native_labels", {
    labels: {
      search: t("search"),
      capture: t("capture"),
      notes: t("notes"),
      cargo: t("cargo"),
      squad: t("squad"),
      plan: t("plan"),
      map: t("map"),
      nps: t("nps"),
      quit: t("quit"),
      captureFailed: t("captureFailed"),
      ocrFailed: t("ocrFailed"),
    },
  }).catch((error) => {
    console.error("[i18n] tray labels not updated", error);
  });
}

/**
 * Speaks the stored language, and follows it when it changes.
 *
 * Nothing renders until the setting is read — a few milliseconds — rather
 * than flashing French at someone who chose another language. On a change
 * the tree under it is remounted: module-level helpers and label tables read
 * the language when they run, and a remount makes sure every one of them runs
 * again.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale | null>(null);

  useEffect(() => {
    let cancelled = false;

    function apply(next: Locale) {
      if (cancelled) return;
      setActiveLocale(next);
      setLocale(next);
      relabelNative();
    }

    void getLocaleSetting().then(apply);

    const unlisten = listen<string>(LOCALE_EVENT, (event) => {
      if (isLocale(event.payload)) apply(event.payload);
    });

    return () => {
      cancelled = true;
      void unlisten.then((stop) => stop());
    };
  }, []);

  if (!locale) return null;

  return (
    <IntlProvider
      key={locale}
      locale={locale}
      messages={MESSAGES[locale]}
      timeZone={TIME_ZONE}
    >
      {children}
    </IntlProvider>
  );
}
