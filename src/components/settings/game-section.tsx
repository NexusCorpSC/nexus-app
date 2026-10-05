import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import {
  DEFAULT_GAME_LOG_DIR,
  getGameLogSettings,
  setGameLogSettings,
} from "@/lib/settings";
import {
  getGameLogStatus,
  syncGameLog,
  type GameLogStatus,
} from "@/lib/game-log";
import { Badge, Button, Card, Field, Input } from "@/components/ui";
import {
  SettingsCardTitle,
  SettingsError,
  SettingsSectionHeader,
} from "@/components/settings/section-header";

export function GameSection() {
  const t = useTranslations("SettingsGame");
  const [dir, setDir] = useState(DEFAULT_GAME_LOG_DIR);
  const [enabled, setEnabled] = useState(true);
  const [saved, setSaved] = useState<{ dir: string; enabled: boolean } | null>(
    null,
  );
  const [status, setStatus] = useState<GameLogStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refreshStatus = useCallback(() => {
    void getGameLogStatus()
      .then(setStatus)
      .catch((cause) => console.error("cannot read the game log status", cause));
  }, []);

  useEffect(() => {
    void getGameLogSettings().then((settings) => {
      setDir(settings.dir);
      setEnabled(settings.enabled);
      setSaved(settings);
    });
    refreshStatus();
  }, [refreshStatus]);

  const dirty =
    saved !== null && (saved.dir !== dir.trim() || saved.enabled !== enabled);

  async function save() {
    setError(null);
    setSaving(true);

    try {
      const next = { dir: dir.trim() || DEFAULT_GAME_LOG_DIR, enabled };
      await setGameLogSettings(next);
      await syncGameLog();
      setDir(next.dir);
      setSaved(next);
      refreshStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <SettingsSectionHeader
        title={t("title")}
        description={t("description")}
      />

      <Card>
        <SettingsCardTitle>{t("cardTitle")}</SettingsCardTitle>
        <div className="space-y-4 p-4">
          <label className="flex cursor-pointer items-center gap-2 text-[13.5px] text-nexus-bright">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="accent-nexus-accent"
            />
            {t("enable")}
          </label>

          <Field label={t("dirLabel")}>
            <div className="flex gap-2">
              <Input
                value={dir}
                onChange={(event) => setDir(event.target.value)}
                placeholder={DEFAULT_GAME_LOG_DIR}
                spellCheck={false}
                disabled={!enabled}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setDir(DEFAULT_GAME_LOG_DIR)}
                disabled={!enabled || dir === DEFAULT_GAME_LOG_DIR}
              >
                {t("defaultDir")}
              </Button>
            </div>
          </Field>
          <p className="text-xs text-nexus-muted">
            {t.rich("dirHint", { code: (chunks) => <code>{chunks}</code> })}
          </p>

          {status ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-nexus-muted">
              {!status.enabled ? (
                <Badge>{t("disabled")}</Badge>
              ) : status.exists ? (
                <Badge tone="success">{t("found")}</Badge>
              ) : (
                <Badge tone="warning">{t("missing")}</Badge>
              )}
              <span className="break-all">{status.path}</span>
            </div>
          ) : null}

          {error ? <SettingsError>{error}</SettingsError> : null}

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
            >
              {t("save")}
            </Button>
          </div>
        </div>
      </Card>
    </section>
  );
}
