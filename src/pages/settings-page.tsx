import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { useAuth } from "@/auth/auth-context";
import {
  ALLOWED_API_BASE_URLS,
  DEFAULT_API_BASE_URL,
  DEFAULT_SHORTCUTS,
  formatShortcut,
  getApiBaseUrl,
  getNotificationCorner,
  getShortcuts,
  isAllowedBaseUrl,
  normalizeBaseUrl,
  setApiBaseUrl,
  setNotificationCorner,
  setShortcuts,
  type Shortcuts,
} from "@/lib/settings";
import {
  applyNotificationCorner,
  DEFAULT_NOTIFICATION_CORNER,
  notify,
  NOTIFICATION_CORNER_LABELS,
  NOTIFICATION_CORNERS,
  type NotificationCorner,
} from "@/lib/notifications";
import {
  applyShortcuts,
  SHORTCUT_LABELS,
  type ShortcutRejection,
} from "@/lib/shortcuts";
import {
  checkForUpdate,
  describeUpdateError,
  installUpdate,
  type Update,
  type UpdateProgress,
} from "@/lib/updates";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { ShortcutInput } from "@/components/shortcut-input";

/**
 * Percentage downloaded, or `null` when there is no total to measure against.
 *
 * A total of zero counts as no total rather than as an empty download: it is
 * not something to show a bar for, and it is not something to divide by.
 */
function updateDownloadPercent(progress: UpdateProgress | null): number | null {
  if (!progress || progress.total === null || progress.total <= 0) return null;
  return Math.min(100, Math.round((progress.downloaded / progress.total) * 100));
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} Mo`;
}

export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const queryClient = useQueryClient();

  const [baseUrl, setBaseUrl] = useState("");
  const [version, setVersion] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [shortcuts, setLocalShortcuts] = useState<Shortcuts>(DEFAULT_SHORTCUTS);
  const [shortcutsSaved, setShortcutsSaved] = useState(false);
  const [rejections, setRejections] = useState<ShortcutRejection[]>([]);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const shortcutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [corner, setCorner] = useState<NotificationCorner>(
    DEFAULT_NOTIFICATION_CORNER,
  );
  const [notificationError, setNotificationError] = useState<string | null>(
    null,
  );

  const [update, setUpdate] = useState<Update | null>(null);
  const [updateState, setUpdateState] = useState<
    "idle" | "checking" | "latest" | "available" | "installing"
  >("idle");
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(
    null,
  );
  const [updateError, setUpdateError] = useState<string | null>(null);
  const downloadPercent = updateDownloadPercent(updateProgress);

  useEffect(() => {
    void getApiBaseUrl().then(setBaseUrl);
    void getVersion().then(setVersion);
    void getShortcuts().then(setLocalShortcuts);
    void getNotificationCorner().then(setCorner);
  }, []);

  // Clears the "Enregistré" flash timers if the screen is left first.
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
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

  /**
   * The choice is applied and shown at once: a corner is far easier to pick
   * when the example lands in it while the list is still open.
   */
  async function handleCornerChange(next: NotificationCorner) {
    setCorner(next);
    setNotificationError(null);

    try {
      // Persisted before it is applied, so a corner the overlay refuses is
      // still the one taken at the next start — and inside the try, because a
      // store that will not write is exactly what the user needs told.
      await setNotificationCorner(next);
      await applyNotificationCorner(next);
      await notify({
        title: "Notifications",
        body: `Elles s'afficheront ${NOTIFICATION_CORNER_LABELS[next].toLowerCase()}.`,
      });
    } catch (cause) {
      setNotificationError(
        cause instanceof Error
          ? cause.message
          : "Le coin d'affichage n'a pas pu être appliqué. Il le sera au prochain démarrage.",
      );
    }
  }

  /** The check the user asked for, so its failures are shown rather than logged. */
  async function handleUpdateCheck() {
    setUpdateError(null);
    setUpdateState("checking");

    try {
      const found = await checkForUpdate();
      setUpdate(found);
      setUpdateState(found ? "available" : "latest");
    } catch (cause) {
      setUpdateState("idle");
      setUpdateError(describeUpdateError(cause));
    }
  }

  /**
   * Nothing after the download returns on Windows: the plugin hands the
   * installer over and ends this process, and the installer brings the app
   * back up. The error path is therefore only about the download itself.
   */
  async function handleUpdateInstall() {
    if (!update) return;

    setUpdateError(null);
    setUpdateState("installing");
    setUpdateProgress({ downloaded: 0, total: null });

    try {
      await installUpdate(update, setUpdateProgress);
    } catch (cause) {
      setUpdateState("available");
      setUpdateProgress(null);
      setUpdateError(
        `L'installation a échoué : ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const normalized = normalizeBaseUrl(baseUrl);

    // The `http` capability only allows the hosts declared in
    // src-tauri/capabilities/default.json; anything else fails at runtime.
    if (!isAllowedBaseUrl(normalized)) {
      setError(
        `Cette URL n'est pas autorisée par les permissions de l'application. Valeurs possibles : ${ALLOWED_API_BASE_URLS.join(", ")}`,
      );
      return;
    }

    await setApiBaseUrl(normalized);
    setBaseUrl(normalized);
    queryClient.clear();
    await refresh();
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Paramètres"
        description="Configuration de la connexion à l'instance Nexus Tools."
      />

      <Card className="mb-4 p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="URL de l'API Nexus Tools">
            <Input
              value={baseUrl}
              placeholder={DEFAULT_API_BASE_URL}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </Field>

          <p className="text-xs text-nexus-accent/50">
            Utilisez <code>http://localhost:3000</code> pour pointer vers une
            instance de développement locale.
          </p>

          <div className="flex items-center gap-3">
            <Button type="submit" size="sm">
              Enregistrer
            </Button>
            {saved ? (
              <span className="text-xs text-emerald-300">Enregistré</span>
            ) : null}
          </div>

          {error ? (
            <p className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200">
              {error}
            </p>
          ) : null}
        </form>
      </Card>

      <Card className="mb-4 p-6">
        <h2 className="mb-1 text-sm font-semibold text-nexus-bright">
          Raccourcis globaux
        </h2>
        <p className="mb-4 text-xs text-nexus-accent/50">
          Actifs même lorsque l'application est réduite. Cliquez sur un champ
          puis appuyez sur la combinaison souhaitée.
        </p>

        <form onSubmit={handleShortcutsSubmit} className="space-y-4">
          <Field label="Recherche en superposition">
            <ShortcutInput
              value={shortcuts.search}
              onChange={(search) =>
                setLocalShortcuts((current) => ({ ...current, search }))
              }
            />
          </Field>

          <Field label="Capture de zone">
            <ShortcutInput
              value={shortcuts.capture}
              onChange={(capture) =>
                setLocalShortcuts((current) => ({ ...current, capture }))
              }
            />
          </Field>

          <Field label="Bloc-notes en superposition">
            <ShortcutInput
              value={shortcuts.notes}
              onChange={(notes) =>
                setLocalShortcuts((current) => ({ ...current, notes }))
              }
            />
          </Field>

          <div className="flex items-center gap-3">
            <Button type="submit" size="sm">
              Appliquer
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setLocalShortcuts(DEFAULT_SHORTCUTS)}
            >
              Valeurs par défaut
            </Button>
            {shortcutsSaved ? (
              <span className="text-xs text-emerald-300">Appliqué</span>
            ) : null}
          </div>

          {shortcutError ? (
            <p className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200">
              {shortcutError}
            </p>
          ) : null}

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
        </form>
      </Card>

      <Card className="mb-4 p-6">
        <h2 className="mb-1 text-sm font-semibold text-nexus-bright">
          Notifications
        </h2>
        <p className="mb-4 text-xs text-nexus-accent/50">
          Elles s'affichent par-dessus le jeu, dans le coin choisi de l'écran où
          se trouve le curseur, puis disparaissent d'elles-mêmes. Survolez-en
          une pour la garder à l'écran.
        </p>

        <div className="space-y-4">
          <Field label="Coin d'affichage">
            <Select
              value={corner}
              onChange={(event) =>
                void handleCornerChange(
                  event.target.value as NotificationCorner,
                )
              }
            >
              {NOTIFICATION_CORNERS.map((value) => (
                <option key={value} value={value}>
                  {NOTIFICATION_CORNER_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              void notify({
                kind: "success",
                title: "Nexus App",
                body: "Ceci est un exemple de notification.",
              })
            }
          >
            Afficher un exemple
          </Button>

          {notificationError ? (
            <p className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200">
              {notificationError}
            </p>
          ) : null}
        </div>
      </Card>

      <Card className="mb-4 p-6">
        <h2 className="mb-1 text-sm font-semibold text-nexus-bright">
          Mises à jour
        </h2>
        <p className="mb-4 text-xs text-nexus-accent/50">
          L'application regarde au démarrage, puis toutes les six heures, si une
          release plus récente est publiée. Rien n'est installé sans votre
          accord.
        </p>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              onClick={() => void handleUpdateCheck()}
              disabled={updateState === "checking" || updateState === "installing"}
            >
              {updateState === "checking" ? "Recherche…" : "Vérifier maintenant"}
            </Button>

            {updateState === "latest" ? (
              <span className="text-xs text-emerald-300">
                Vous avez la dernière version ({version || "—"}).
              </span>
            ) : null}
          </div>

          {update ? (
            <div className="space-y-3 rounded-lg border border-nexus-accent/20 bg-nexus-abyss/40 p-4">
              <div className="flex items-baseline gap-2">
                <p className="text-sm font-medium text-nexus-bright">
                  Version {update.version}
                </p>
                <span className="text-xs text-nexus-accent/50">
                  installée : {update.currentVersion}
                </span>
              </div>

              {update.body ? (
                <p className="max-h-40 overflow-y-auto whitespace-pre-line text-xs text-nexus-accent/70">
                  {update.body}
                </p>
              ) : null}

              {updateState === "installing" ? (
                <div className="space-y-1.5">
                  {/* No bar when the size was never announced: a full one would
                      read as finished, an empty one as stuck. The bytes
                      received say more than either. */}
                  {downloadPercent !== null ? (
                    <div className="h-1 overflow-hidden rounded-full bg-nexus-accent/10">
                      <div
                        className="h-full rounded-full bg-nexus-accent/70 transition-[width]"
                        style={{ width: `${downloadPercent}%` }}
                      />
                    </div>
                  ) : null}
                  <p className="text-xs text-nexus-accent/60">
                    Téléchargement…{" "}
                    {downloadPercent !== null
                      ? `${downloadPercent} %`
                      : formatBytes(updateProgress?.downloaded ?? 0)}
                    . L'application redémarrera pour terminer.
                  </p>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleUpdateInstall()}
                >
                  Installer et redémarrer
                </Button>
              )}
            </div>
          ) : null}

          {updateError ? (
            <p className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200">
              {updateError}
            </p>
          ) : null}
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-3 text-sm font-semibold text-nexus-bright">
          À propos
        </h2>
        <dl className="space-y-2 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-nexus-accent/50">Version</dt>
            <dd className="text-nexus-bright/85">{version || "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-nexus-accent/50">Session</dt>
            <dd className="text-nexus-bright/85">
              {user ? user.email : "Non connecté"}
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
