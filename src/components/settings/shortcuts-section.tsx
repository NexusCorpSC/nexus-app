import { useEffect, useRef, useState, type FormEvent } from "react";
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
  SHORTCUT_LABELS,
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
 * `hint` is the one line under the label; `detail`, when there is more to it,
 * is the full explanation the page used to show, kept as the hint's tooltip.
 */
type ShortcutRow = {
  action: ShortcutAction;
  label: string;
  hint: string;
  detail?: string;
};

/** The combinations that open a window, overlay or capture. */
const WINDOW_ROWS: ShortcutRow[] = [
  {
    action: "search",
    label: "Recherche",
    hint: "Recherche rapide en superposition.",
  },
  {
    action: "capture",
    label: "Capture de zone",
    hint: "Sélectionne une zone de l'écran à capturer.",
  },
  { action: "notes", label: "Bloc-notes", hint: "Bloc-notes en superposition." },
  {
    action: "cargo",
    label: "Feuille de cargo",
    hint: "Feuille de cargo en superposition.",
  },
  { action: "squad", label: "Escouade", hint: "Escouade en superposition." },
  {
    action: "plan",
    label: "Plan de vol",
    hint: "Plan de vol en superposition.",
  },
  {
    action: "map",
    label: "Carte",
    hint: "La carte épinglée depuis un lieu, ou choisie dans la fenêtre.",
    detail:
      "Affiche la carte épinglée depuis la fiche d'un lieu, ou choisie dans la fenêtre elle-même.",
  },
];

/** The combinations used while playing, over the overlays already shown. */
const IN_GAME_ROWS: ShortcutRow[] = [
  {
    action: "radial",
    label: "Maintenir le menu radial rapide",
    hint: "Maintenez, visez une action à la souris, relâchez. Échap annule.",
    detail:
      "Maintenez la combinaison pour afficher le menu au centre de l'écran, donnez un coup de souris vers une action, puis relâchez pour la lancer. Relâcher sans bouger, ou Échap, annule. READY et Éliminé/Actif n'y figurent que dans une escouade ; le verrouillage et la capture de zone, toujours.",
  },
  {
    action: "lock",
    label: "Verrouillage",
    hint: "Les clics passent au jeu ; le menu radial reste utilisable.",
    detail:
      "Verrouille toutes les superpositions affichées — les clics passent au jeu — ou, si l'une l'est déjà, les déverrouille toutes. Le menu radial n'est pas concerné : il reste utilisable.",
  },
  {
    action: "opacity",
    label: "Opacité",
    hint: "Efface les superpositions, le jeu vu au travers, ou les rend.",
    detail:
      "Efface toutes les superpositions d'un coup — le jeu vu au travers — ou leur rend leur panneau. Chacune porte aussi le bouton, qui passe par le fond ombré entre les deux.",
  },
];

export function ShortcutsSection() {
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
        cause instanceof Error
          ? cause.message
          : "Les raccourcis n'ont pas pu être appliqués. Ils le seront au prochain démarrage.",
      );
    }

    setShortcutsSaved(true);
    if (shortcutTimer.current) clearTimeout(shortcutTimer.current);
    shortcutTimer.current = setTimeout(() => setShortcutsSaved(false), 2500);
  }

  function renderRows(rows: ShortcutRow[]) {
    return rows.map((row) => (
      <div
        key={row.action}
        className="flex items-center gap-3 border-b border-nexus-accent/6 px-4 py-2.5 last:border-b-0"
      >
        <div className="min-w-0 flex-1">
          <label
            htmlFor={`shortcut-${row.action}`}
            className="block text-[13.5px] text-nexus-white"
          >
            {row.label}
          </label>
          <p className="truncate text-[11.5px] text-nexus-dim" title={row.detail ?? row.hint}>
            {row.hint}
          </p>
        </div>
        <ShortcutInput
          id={`shortcut-${row.action}`}
          value={shortcuts[row.action]}
          onChange={(accelerator) =>
            setLocalShortcuts((current) => ({
              ...current,
              [row.action]: accelerator,
            }))
          }
        />
      </div>
    ));
  }

  return (
    // One form around the header too: "Appliquer" sits up there and has to
    // stay a submit button so Entrée keeps working as before.
    <form onSubmit={handleShortcutsSubmit}>
      <SettingsSectionHeader
        title="Raccourcis clavier"
        description="Actifs même application réduite. Cliquez sur une combinaison puis appuyez sur la nouvelle."
        actions={
          <>
            {shortcutsSaved ? (
              <span className="text-xs text-emerald-300">Appliqué</span>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setLocalShortcuts(DEFAULT_SHORTCUTS)}
            >
              Valeurs par défaut
            </Button>
            <Button type="submit" size="sm">
              Appliquer
            </Button>
          </>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <SettingsCardTitle>Fenêtres</SettingsCardTitle>
          {renderRows(WINDOW_ROWS)}
        </Card>
        <Card>
          <SettingsCardTitle>En jeu</SettingsCardTitle>
          {renderRows(IN_GAME_ROWS)}
        </Card>
      </div>

      <div className="mt-4 space-y-3">
        {shortcutError ? <SettingsError>{shortcutError}</SettingsError> : null}

        {rejections.length > 0 ? (
          <div className="space-y-1 rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
            <p>
              Ces combinaisons n'ont pas pu être prises. Elles restent
              enregistrées mais sont inactives : choisissez-en d'autres.
            </p>
            <ul className="list-disc space-y-0.5 pl-4">
              {rejections.map((rejection) => (
                <li key={rejection.action}>
                  {SHORTCUT_LABELS[rejection.action]} —{" "}
                  {formatShortcut(rejection.accelerator)} : {rejection.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </form>
  );
}
