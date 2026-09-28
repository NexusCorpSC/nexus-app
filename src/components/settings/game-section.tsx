import { useCallback, useEffect, useState } from "react";
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
      setError(
        cause instanceof Error
          ? cause.message
          : "Les réglages n'ont pas pu être enregistrés.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <SettingsSectionHeader
        title="Jeu"
        description="Nexus App lit le Game.log de Star Citizen pendant que vous jouez. Quand vous recevez un blueprint en jeu, une notification vous propose de l'ajouter à vos blueprints Nexus."
      />

      <Card>
        <SettingsCardTitle>Analyse du Game.log</SettingsCardTitle>
        <div className="space-y-4 p-4">
          <label className="flex cursor-pointer items-center gap-2 text-[13.5px] text-nexus-bright">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="accent-nexus-accent"
            />
            Analyser le Game.log
          </label>

          <Field label="Dossier de Star Citizen">
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
                Par défaut
              </Button>
            </div>
          </Field>
          <p className="text-xs text-nexus-muted">
            Le dossier qui contient <code>Game.log</code>, par exemple celui de
            la version LIVE ou PTU.
          </p>

          {status ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-nexus-muted">
              {!status.enabled ? (
                <Badge>Désactivée</Badge>
              ) : status.exists ? (
                <Badge tone="success">Game.log trouvé</Badge>
              ) : (
                <Badge tone="warning">Game.log introuvable</Badge>
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
              Enregistrer
            </Button>
          </div>
        </div>
      </Card>
    </section>
  );
}
