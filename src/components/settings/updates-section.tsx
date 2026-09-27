import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  checkForUpdate,
  describeUpdateError,
  installUpdate,
  type Update,
  type UpdateProgress,
} from "@/lib/updates";
import { Button, Card } from "@/components/ui";
import {
  SettingsCardTitle,
  SettingsError,
  SettingsSectionHeader,
} from "@/components/settings/section-header";

/**
 * Percentage downloaded, or `null` when there is no total to measure against.
 *
 * A total of zero counts as no total rather than as an empty download: it is
 * not something to show a bar for, and it is not something to divide by.
 */
function updateDownloadPercent(progress: UpdateProgress | null): number | null {
  if (!progress || progress.total === null || progress.total <= 0) return null;
  return Math.min(
    100,
    Math.round((progress.downloaded / progress.total) * 100),
  );
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} Mo`;
}

export function UpdatesSection() {
  const [version, setVersion] = useState("");
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
    void getVersion().then(setVersion);
  }, []);

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

  return (
    <section>
      <SettingsSectionHeader
        title="Mises à jour"
        description="L'application regarde au démarrage, puis toutes les six heures, si une release plus récente est publiée. Rien n'est installé sans votre accord."
        actions={
          <Button
            type="button"
            size="sm"
            onClick={() => void handleUpdateCheck()}
            disabled={updateState === "checking" || updateState === "installing"}
          >
            {updateState === "checking" ? "Recherche…" : "Vérifier maintenant"}
          </Button>
        }
      />

      <div className="space-y-4">
        <Card>
          <SettingsCardTitle>Version</SettingsCardTitle>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
            <span className="text-nexus-muted">Installée</span>
            <span className="font-mono text-xs text-nexus-white">
              {version || "—"}
            </span>
          </div>
          {updateState === "latest" ? (
            <p className="border-t border-nexus-accent/6 px-4 py-2.5 text-xs text-emerald-300">
              Vous avez la dernière version ({version || "—"}).
            </p>
          ) : null}
        </Card>

        {update ? (
          <Card>
            <SettingsCardTitle>Disponible</SettingsCardTitle>
            <div className="space-y-3 p-4">
              <div className="flex items-baseline gap-2">
                <p className="font-display text-[15px] font-semibold text-nexus-white">
                  Version {update.version}
                </p>
                <span className="text-xs text-nexus-dim">
                  installée : {update.currentVersion}
                </span>
              </div>

              {update.body ? (
                <p className="max-h-40 overflow-y-auto whitespace-pre-line text-xs text-nexus-muted">
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
                  <p className="text-xs text-nexus-muted">
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
          </Card>
        ) : null}

        {updateError ? <SettingsError>{updateError}</SettingsError> : null}
      </div>
    </section>
  );
}
