import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useTranslations } from "use-intl";
import { isThemeId, MANUFACTURER_NAMES, type ThemeId } from "@/lib/themes";

/** The theme on this window's document, kept in step with it. */
function useDocumentTheme(): ThemeId {
  const read = () => {
    const theme = document.documentElement.dataset.theme;
    return isThemeId(theme) ? theme : "nexus";
  };
  const [theme, setTheme] = useState<ThemeId>(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return theme;
}

/**
 * On the rail, the manufacturer whose colours the interface wears, while it
 * is not Nexus's own. A click opens Settings › Appearance.
 */
export function RailThemeChip() {
  const t = useTranslations("SettingsAppearance");
  const theme = useDocumentTheme();
  if (theme === "nexus") return null;
  const name = MANUFACTURER_NAMES[theme];
  return (
    <NavLink
      to="/settings?section=appearance"
      title={t("chip", { maker: name })}
      aria-label={t("chip", { maker: name })}
      className="nexus-label w-[54px] !tracking-[0.08em] truncate rounded-nexus-sm border border-nexus-accent/40 px-1 py-1 text-center text-[9px] font-semibold text-nexus-accent transition-colors hover:bg-nexus-accent/10"
    >
      {name.split(" ")[0]}
    </NavLink>
  );
}
