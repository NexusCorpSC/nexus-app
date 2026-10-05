import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslations } from "use-intl";
import { getLocale } from "@/i18n/locale";
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

/** Megabytes with one decimal, in the language on screen; the unit is the message's. */
function formatMegabytes(bytes: number): string {
  return (bytes / 1_000_000).toLocaleString(getLocale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function UpdatesSection() {
  const t = useTranslations("SettingsUpdates");
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
        t("installFailed", {
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    }
  }

  return (
    <section>
      <SettingsSectionHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button
            type="button"
            size="sm"
            onClick={() => void handleUpdateCheck()}
            disabled={
              updateState === "checking" || updateState === "installing"
            }
          >
            {updateState === "checking" ? t("checking") : t("check")}
          </Button>
        }
      />

      <div className="space-y-4">
        <Card>
          <SettingsCardTitle>{t("version")}</SettingsCardTitle>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
            <span className="text-nexus-muted">{t("installed")}</span>
            <span className="font-mono text-xs text-nexus-white">
              {version || "—"}
            </span>
          </div>
          {updateState === "latest" ? (
            <p className="border-t border-nexus-accent/6 px-4 py-2.5 text-xs text-emerald-300">
              {t("latest", { version: version || "—" })}
            </p>
          ) : null}
        </Card>

        {update ? (
          <Card>
            <SettingsCardTitle>{t("available")}</SettingsCardTitle>
            <div className="space-y-3 p-4">
              <div className="flex items-baseline gap-2">
                <p className="font-display text-[15px] font-semibold text-nexus-white">
                  {t("versionNumber", { version: update.version })}
                </p>
                <span className="text-xs text-nexus-dim">
                  {t("installedVersion", { version: update.currentVersion })}
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
                    {t("downloading", {
                      progress:
                        downloadPercent !== null
                          ? t("percent", { percent: downloadPercent })
                          : t("megabytes", {
                              size: formatMegabytes(
                                updateProgress?.downloaded ?? 0,
                              ),
                            }),
                    })}
                  </p>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleUpdateInstall()}
                >
                  {t("install")}
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
