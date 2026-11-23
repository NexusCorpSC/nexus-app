import { useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { Check } from "lucide-react";
import { useTranslations } from "use-intl";
import { Card } from "@/components/ui";
import {
  SettingsCardTitle,
  SettingsError,
  SettingsSectionHeader,
} from "@/components/settings/section-header";
import { getAppearance, setAppearance } from "@/lib/settings";
import {
  APPEARANCE_EVENT,
  DEFAULT_APPEARANCE,
  MANUFACTURER_NAMES,
  THEME_IDS,
  THEME_SWATCHES,
  type Appearance,
  type ThemeId,
} from "@/lib/themes";
import { cn } from "@/lib/utils";

/**
 * Settings › Appearance: whether the interface follows the ship flown, and
 * the theme otherwise. Saved on every change, and broadcast so that the main
 * window's theme keeper (`useShipTheme`) applies it at once.
 */
export function AppearanceSection() {
  const t = useTranslations("SettingsAppearance");
  const [appearance, setLocal] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [error, setError] = useState(false);

  useEffect(() => {
    let gone = false;
    void getAppearance()
      .then((stored) => {
        if (!gone) setLocal(stored);
      })
      .catch((cause) => console.error("cannot read the appearance", cause));
    return () => {
      gone = true;
    };
  }, []);

  function update(patch: Partial<Appearance>) {
    const next = { ...appearance, ...patch };
    setLocal(next);
    setError(false);
    void setAppearance(next)
      .then(() => emit(APPEARANCE_EVENT, next))
      .catch((cause) => {
        console.error("cannot save the appearance", cause);
        setError(true);
      });
  }

  const themeName = (id: ThemeId) =>
    id === "nexus" ? t("nexus") : MANUFACTURER_NAMES[id];

  return (
    <div className="space-y-4">
      <SettingsSectionHeader title={t("title")} description={t("description")} />

      <Card>
        <SettingsCardTitle>{t("mode.title")}</SettingsCardTitle>
        <div className="space-y-2 p-4" role="radiogroup" aria-label={t("mode.title")}>
          {(["ship", "fixed"] as const).map((mode) => {
            const checked = appearance.mode === mode;
            return (
              <label
                key={mode}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-nexus-sm border px-3 py-2.5 transition-colors",
                  checked
                    ? "border-nexus-accent/40 bg-nexus-accent/8"
                    : "border-nexus-accent/12 hover:border-nexus-accent/25",
                )}
              >
                <input
                  type="radio"
                  name="appearance-mode"
                  checked={checked}
                  onChange={() => update({ mode })}
                  className="mt-0.5 accent-nexus-accent"
                />
                <span>
                  <span className="block text-[13.5px] font-medium text-nexus-white">
                    {t(`mode.${mode}`)}
                  </span>
                  <span className="block text-xs text-nexus-muted">
                    {t(`mode.${mode}Hint`)}
                  </span>
                </span>
              </label>
            );
          })}
          <p className="text-xs text-nexus-dim">{t("mode.telemetryHint")}</p>
        </div>
      </Card>

      <Card>
        <SettingsCardTitle>
          {appearance.mode === "ship" ? t("theme.titleShip") : t("theme.titleFixed")}
        </SettingsCardTitle>
        <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-4">
          {THEME_IDS.map((id) => {
            const { accent, tint } = THEME_SWATCHES[id];
            const checked = appearance.theme === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={checked}
                onClick={() => update({ theme: id })}
                className={cn(
                  "flex items-center gap-2.5 rounded-nexus-sm border px-2.5 py-2 text-left text-[12.5px] transition-colors",
                  checked
                    ? "border-nexus-accent/50 bg-nexus-accent/10 text-nexus-white"
                    : "border-nexus-accent/12 text-nexus-bright hover:border-nexus-accent/30",
                )}
              >
                <span
                  aria-hidden
                  className="size-6 shrink-0 rounded-[4px] border border-nexus-accent/10"
                  style={{
                    background: `linear-gradient(135deg, ${accent} 0 55%, ${tint} 55%)`,
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{themeName(id)}</span>
                {checked ? <Check className="size-3.5 shrink-0 text-nexus-accent" /> : null}
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <SettingsCardTitle>{t("options.title")}</SettingsCardTitle>
        <div className="space-y-3 p-4">
          {(
            [
              ["keepLastShip", appearance.mode !== "ship"],
              ["anySeat", appearance.mode !== "ship"],
              ["announce", appearance.mode !== "ship"],
              ["effects", false],
            ] as const
          ).map(([key, disabled]) => (
            <div key={key} className="space-y-0.5">
              <label
                className={cn(
                  "flex items-center gap-2 text-[13.5px] text-nexus-bright",
                  disabled ? "opacity-50" : "cursor-pointer",
                )}
              >
                <input
                  type="checkbox"
                  checked={appearance[key]}
                  disabled={disabled}
                  onChange={(event) => update({ [key]: event.target.checked })}
                  className="accent-nexus-accent"
                />
                {t(`options.${key}`)}
              </label>
              <p className="pl-6 text-xs text-nexus-muted">{t(`options.${key}Hint`)}</p>
            </div>
          ))}
          {error ? <SettingsError>{t("saveError")}</SettingsError> : null}
        </div>
      </Card>
    </div>
  );
}
