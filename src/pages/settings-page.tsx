import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";
import { GeneralSection } from "@/components/settings/general-section";
import { AccountSection } from "@/components/settings/account-section";
import { ShortcutsSection } from "@/components/settings/shortcuts-section";
import { NotificationsSection } from "@/components/settings/notifications-section";
import { UpdatesSection } from "@/components/settings/updates-section";
import { GameSection } from "@/components/settings/game-section";

/**
 * The rubriques, in the order of the sub-navigation. The key is what goes in
 * `?section=`, so a link elsewhere in the app can open one directly.
 *
 * There is no "Superpositions" rubrique: the only overlay settings are the
 * opacity and lock combinations, which live with the other shortcuts.
 */
const SECTIONS = [
  { key: "general", label: "Général", Component: GeneralSection },
  { key: "account", label: "Compte", Component: AccountSection },
  { key: "shortcuts", label: "Raccourcis clavier", Component: ShortcutsSection },
  { key: "notifications", label: "Notifications", Component: NotificationsSection },
  { key: "game", label: "Jeu", Component: GameSection },
  { key: "updates", label: "Mises à jour", Component: UpdatesSection },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

function isSectionKey(value: string | null): value is SectionKey {
  return SECTIONS.some((section) => section.key === value);
}

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("section");
  // An unknown or missing value falls back rather than showing an empty page.
  const active: SectionKey = isSectionKey(requested) ? requested : "general";

  function select(key: SectionKey) {
    // Replaced rather than pushed: switching rubriques is not a navigation the
    // back button should have to walk through one by one.
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("section", key);
        return next;
      },
      { replace: true },
    );
  }

  return (
    <div>
      <PageHeader
        title="Paramètres"
        description="Réglages de l'application, rangés par sujet."
      />

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <nav
          aria-label="Rubriques des paramètres"
          className="flex shrink-0 flex-row flex-wrap gap-1 md:w-47 md:flex-col"
        >
          {SECTIONS.map((section) => {
            const isActive = section.key === active;
            return (
              <button
                key={section.key}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => select(section.key)}
                className={cn(
                  "rounded-lg px-3 py-2 text-left text-[13.5px] transition-colors",
                  isActive
                    ? "bg-nexus-accent/13 font-medium text-nexus-white"
                    : "text-nexus-accent/70 hover:bg-nexus-accent/6 hover:text-nexus-accent",
                )}
              >
                {section.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1">
          {/* Every rubrique stays mounted and only the chosen one is shown:
              unapplied shortcuts, a download under way or a flash message must
              survive a look at another rubrique, as they did on a single page. */}
          {SECTIONS.map(({ key, Component }) => (
            <div key={key} hidden={key !== active}>
              <Component />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
