import { useLocale, useTranslations } from "use-intl";
import { Card, Segmented } from "@/components/ui";
import { SettingsCardTitle } from "@/components/settings/section-header";
import { changeLocale } from "@/i18n/i18n-provider";
import { LOCALE_NAMES, LOCALES, isLocale } from "@/i18n/locale";

/**
 * The language of the app. Each one is named in itself, so that someone who
 * landed in a language they do not read can still find their own.
 */
export function LanguageCard() {
  const t = useTranslations("Settings.language");
  const locale = useLocale();

  return (
    <Card>
      <SettingsCardTitle>{t("title")}</SettingsCardTitle>
      <div className="space-y-3 p-4">
        <Segmented
          label={t("title")}
          value={locale}
          options={LOCALES.map((value) => ({ value, label: LOCALE_NAMES[value] }))}
          onChange={(value) => {
            if (isLocale(value) && value !== locale) {
              void changeLocale(value).catch((error) => {
                console.error("[settings] cannot change the language", error);
              });
            }
          }}
          className="w-fit"
        />
        <p className="text-[11.5px] text-nexus-dim">{t("hint")}</p>
      </div>
    </Card>
  );
}
