import type { Locale } from "@/i18n/locale";
import type { Messages } from "@/i18n/messages-types";

// Makes `useTranslations` and `t("…")` check namespaces and keys against the
// French files, and `useLocale` return one of the app's locales.
declare module "use-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
