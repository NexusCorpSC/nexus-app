import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "use-intl";
import {
  DEFAULT_SHORTCUTS,
  formatShortcut,
  getShortcuts,
  setShortcuts,
  type ShortcutAction,
  type Shortcuts,
} from "@/lib/settings";
import {
  applyShortcuts,
  describeShortcutRejection,
  shortcutLabel,
  type ShortcutRejection,
} from "@/lib/shortcuts";
import { Button, Card } from "@/components/ui";
import { ShortcutInput } from "@/components/shortcut-input";
import {
  SettingsCardTitle,
  SettingsError,
  SettingsSectionHeader,
} from "@/components/settings/section-header";

/**
 * Each row shows its label and a one-line hint (`rows.<action>` in the
 * messages); the ones with more to it also carry `detail`, the full
 * explanation the page used to show, kept as the hint's tooltip.
 */
const DETAILED = ["map", "radial", "talk", "lock", "opacity"] as const;

type DetailedAction = (typeof DETAILED)[number];

function hasDetail(action: ShortcutAction): action is DetailedAction {
  return (DETAILED as readonly ShortcutAction[]).includes(action);
}

/** The combinations that open a window, overlay or capture. */
const WINDOW_ROWS: ShortcutAction[] = [
  "search",
  "capture",
  "notes",
  "cargo",
  "squad",
  "plan",
  "map",
  "nps",
  "chat",
];

/** The combinations used while playing, over the overlays already shown. */
const IN_GAME_ROWS: ShortcutAction[] = ["radial", "talk", "lock", "opacity"];

export function ShortcutsSection() {
  const t = useTranslations("SettingsShortcuts");
  const [shortcuts, setLocalShortcuts] = useState<Shortcuts>(DEFAULT_SHORTCUTS);
  const [shortcutsSaved, setShortcutsSaved] = useState(false);
  const [rejections, setRejections] = useState<ShortcutRejection[]>([]);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const shortcutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void getShortcuts().then(setLocalShortcuts);
  }, []);

  // Clears the "Appliqué" flash timer if the screen is left first.
  useEffect(
    () => () => {
      if (shortcutTimer.current) clearTimeout(shortcutTimer.current);
    },
    [],
  );

  /**
   * Each combination is bound on its own, so a conflict costs only that one.
   * The choice is persisted either way — it is the user's — and the ones the
   * system refused are listed underneath so they can be changed.
   */
  async function handleShortcutsSubmit(event: FormEvent) {
    event.preventDefault();
    setShortcutError(null);

    // Persisted before binding: "either way" has to hold for the call failing
    // outright too, not just for a combination the system hands back.
    await setShortcuts(shortcuts);

    try {
      setRejections(await applyShortcuts(shortcuts));
    } catch (cause) {
      setRejections([]);
      setShortcutError(
        cause instanceof Error ? cause.message : t("applyError"),
      );
    }

    setShortcutsSaved(true);
    if (shortcutTimer.current) clearTimeout(shortcutTimer.current);
    shortcutTimer.current = setTimeout(() => setShortcutsSaved(false), 2500);
  }

  function renderRows(actions: ShortcutAction[]) {
    return actions.map((action) => {
      const hint = t(`rows.${action}.hint`);

      return (
        <div
          key={action}
          className="flex items-center gap-3 border-b border-nexus-accent/6 px-4 py-2.5 last:border-b-0"
        >
          <div className="min-w-0 flex-1">
            <label
              htmlFor={`shortcut-${action}`}
              className="block text-[13.5px] text-nexus-white"
            >
              {t(`rows.${action}.label`)}
            </label>
            <p
              className="truncate text-[11.5px] text-nexus-dim"
              title={hasDetail(action) ? t(`rows.${action}.detail`) : hint}
            >
              {hint}
            </p>
          </div>
          <ShortcutInput
            id={`shortcut-${action}`}
            value={shortcuts[action]}
            onChange={(accelerator) =>
              setLocalShortcuts((current) => ({
                ...current,
                [action]: accelerator,
              }))
            }
          />
        </div>
      );
    });
  }

  return (
    // One form around the header too: "Appliquer" sits up there and has to
    // stay a submit button so Entrée keeps working as before.
    <form onSubmit={handleShortcutsSubmit}>
      <SettingsSectionHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            {shortcutsSaved ? (
              <span className="text-xs text-emerald-300">{t("applied")}</span>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setLocalShortcuts(DEFAULT_SHORTCUTS)}
            >
              {t("defaults")}
            </Button>
            <Button type="submit" size="sm">
              {t("apply")}
            </Button>
          </>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <SettingsCardTitle>{t("windows")}</SettingsCardTitle>
          {renderRows(WINDOW_ROWS)}
        </Card>
        <Card>
          <SettingsCardTitle>{t("inGame")}</SettingsCardTitle>
          {renderRows(IN_GAME_ROWS)}
        </Card>
      </div>

      <div className="mt-4 space-y-3">
        {shortcutError ? <SettingsError>{shortcutError}</SettingsError> : null}

        {rejections.length > 0 ? (
          <div className="space-y-1 rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
            <p>{t("rejected")}</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {rejections.map((rejection) => (
                <li key={rejection.action}>
                  {t("rejection", {
                    label: shortcutLabel(rejection.action),
                    accelerator: formatShortcut(rejection.accelerator),
                    reason: describeShortcutRejection(rejection.reason),
                  })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </form>
  );
}
