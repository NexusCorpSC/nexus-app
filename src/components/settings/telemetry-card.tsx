import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { Badge, Button, Card, Modal } from "@/components/ui";
import {
  SettingsCardTitle,
  SettingsError,
} from "@/components/settings/section-header";
import {
  getSquadAutoDown,
  getTelemetryEnabled,
  setSquadAutoDown,
  setTelemetryEnabled,
} from "@/lib/settings";
import {
  enableTelemetryEnv,
  enableTelemetryInGame,
  getTelemetryActivation,
  syncTelemetry,
  telemetryErrorCode,
  type Activation,
} from "@/lib/telemetry";
import { useTelemetry } from "@/hooks/use-telemetry";
import { TelemetryBadge } from "@/components/telemetry/telemetry-panel";

const ENV_VAR = "GRPC_CLIENT_SERVER_ENABLED";
/** The same, for a player who would rather do it themselves. */
const ENV_COMMAND = `[Environment]::SetEnvironmentVariable('${ENV_VAR}','1','User')`;

/**
 * The game's telemetry: whether the app listens to it, and the switch in the
 * game's `attributes.xml` that turns the service on — written only on a
 * click, with the game closed, after a copy of the file — and the user
 * environment variable the game needs as well.
 */
export function TelemetrySettingsCard() {
  const t = useTranslations("SettingsGame.telemetry");
  const errors = useTranslations("Telemetry.errors");
  const telemetry = useTelemetry();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [autoDown, setAutoDown] = useState<boolean | null>(null);
  const [activation, setActivation] = useState<Activation | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [envDone, setEnvDone] = useState(false);

  const refresh = useCallback(() => {
    void getTelemetryActivation()
      .then(setActivation)
      .catch((cause) =>
        console.error("cannot read the game's attributes", cause),
      );
  }, []);

  useEffect(() => {
    void getTelemetryEnabled().then(setEnabled);
    void getSquadAutoDown().then(setAutoDown);
    refresh();
  }, [refresh]);

  async function toggle(next: boolean) {
    setEnabled(next);
    await setTelemetryEnabled(next);
    await syncTelemetry().catch(() => {});
  }

  async function toggleAutoDown(next: boolean) {
    setAutoDown(next);
    await setSquadAutoDown(next);
  }

  function describe(cause: unknown) {
    const code = telemetryErrorCode(cause);
    return code ? errors(code) : String(cause);
  }

  async function activate(build: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setActivation(await enableTelemetryInGame(build));
      setDone(build);
    } catch (cause) {
      setError(describe(cause));
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function enableEnv() {
    setBusy(true);
    setError(null);
    setEnvDone(false);
    try {
      setActivation(await enableTelemetryEnv());
      setEnvDone(true);
    } catch (cause) {
      setError(describe(cause));
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <SettingsCardTitle>{t("title")}</SettingsCardTitle>
      <div className="space-y-4 p-4">
        <p className="text-xs text-nexus-muted">{t("description")}</p>

        <label className="flex cursor-pointer items-center gap-2 text-[13.5px] text-nexus-bright">
          <input
            type="checkbox"
            checked={enabled ?? true}
            disabled={enabled === null}
            onChange={(event) => void toggle(event.target.checked)}
            className="accent-nexus-accent"
          />
          {t("enable")}
        </label>

        <div className="space-y-1">
          <label className="flex cursor-pointer items-center gap-2 text-[13.5px] text-nexus-bright">
            <input
              type="checkbox"
              checked={autoDown ?? true}
              disabled={autoDown === null || enabled === false}
              onChange={(event) => void toggleAutoDown(event.target.checked)}
              className="accent-nexus-accent"
            />
            {t("squadAutoDown")}
          </label>
          <p className="pl-6 text-xs text-nexus-muted">
            {t("squadAutoDownHint")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-nexus-muted">
          <TelemetryBadge telemetry={telemetry} />
          <span>{t("port", { port: telemetry.port })}</span>
        </div>

        <div className="space-y-2">
          <div className="font-display text-[11px] font-semibold tracking-[0.12em] text-nexus-muted uppercase">
            {t("inGame")}
          </div>
          {activation === null ? null : (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-nexus-muted">{t("envTitle")}</span>
                <span className="font-mono text-nexus-bright">{ENV_VAR}</span>
                {activation.envEnabled ? (
                  <Badge tone="success">{t("enabled")}</Badge>
                ) : (
                  <>
                    <Badge>{t("notEnabled")}</Badge>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void enableEnv()}
                    >
                      {t("envSet")}
                    </Button>
                  </>
                )}
              </div>
              <p className="text-xs text-nexus-muted">{t("envHint")}</p>
              {!activation.envEnabled ? (
                <p className="break-all font-mono text-xs text-nexus-dim select-text">
                  {t("envManual", { command: ENV_COMMAND })}
                </p>
              ) : null}
              {envDone ? (
                <p role="status" className="text-xs text-emerald-200">
                  {t("envDone")}
                </p>
              ) : null}
            </div>
          )}
          {activation === null ? null : activation.builds.length === 0 ? (
            <p className="text-xs text-nexus-muted">{t("noBuild")}</p>
          ) : (
            <ul className="space-y-2">
              {activation.builds.map((build) => (
                <li
                  key={build.name}
                  className="flex flex-wrap items-center gap-2 text-[13px]"
                >
                  <span className="font-mono text-nexus-bright">
                    {build.name}
                  </span>
                  {build.enabled ? (
                    <Badge tone="success">{t("enabled")}</Badge>
                  ) : (
                    <>
                      <Badge>{t("notEnabled")}</Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy || activation.gameRunning}
                        onClick={() => setConfirming(build.name)}
                      >
                        {t("activate")}
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {activation?.gameRunning ? (
            <p className="text-xs text-amber-200">{t("gameRunning")}</p>
          ) : null}
          {done ? (
            <p role="status" className="text-xs text-emerald-200">
              {t("done", { build: done })}
            </p>
          ) : null}
          {error ? <SettingsError>{error}</SettingsError> : null}
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="ghost" onClick={refresh}>
              {t("refresh")}
            </Button>
          </div>
        </div>
      </div>

      <Modal
        open={confirming !== null}
        title={t("confirmTitle", { build: confirming ?? "" })}
        onClose={() => setConfirming(null)}
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                const build = confirming;
                setConfirming(null);
                if (build) void activate(build);
              }}
            >
              {t("confirm")}
            </Button>
          </div>
        }
      >
        <div className="space-y-2 text-[13.5px] text-nexus-soft">
          <p>{t("confirmBody")}</p>
          <p className="break-all font-mono text-xs text-nexus-muted">
            {activation?.builds.find((build) => build.name === confirming)
              ?.attributesPath ?? ""}
          </p>
        </div>
      </Modal>
    </Card>
  );
}
