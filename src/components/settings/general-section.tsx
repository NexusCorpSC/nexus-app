import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { useAuth } from "@/auth/auth-context";
import {
  ALLOWED_API_BASE_URLS,
  DEFAULT_API_BASE_URL,
  getApiBaseUrl,
  isAllowedBaseUrl,
  normalizeBaseUrl,
  setApiBaseUrl,
} from "@/lib/settings";
import { Button, Card, Field, Input } from "@/components/ui";
import {
  SettingsCardTitle,
  SettingsError,
  SettingsSectionHeader,
} from "@/components/settings/section-header";

/** The instance the app talks to, and what the app itself is. */
export function GeneralSection() {
  const { refresh } = useAuth();
  const queryClient = useQueryClient();

  const [baseUrl, setBaseUrl] = useState("");
  const [version, setVersion] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void getApiBaseUrl().then(setBaseUrl);
    void getVersion().then(setVersion);
  }, []);

  // Clears the "Enregistré" flash timer if the screen is left first.
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

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
    <section>
      <SettingsSectionHeader
        title="Général"
        description="L'instance Nexus Tools à laquelle l'application se connecte."
      />

      <div className="space-y-4">
        <Card>
          <SettingsCardTitle>Instance</SettingsCardTitle>
          <form onSubmit={handleSubmit} className="space-y-4 p-4">
            <Field label="URL de l'API Nexus Tools">
              <Input
                value={baseUrl}
                placeholder={DEFAULT_API_BASE_URL}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </Field>

            <p className="text-[11.5px] text-nexus-dim">
              Utilisez{" "}
              <code className="font-mono text-nexus-muted">
                http://localhost:3000
              </code>{" "}
              pour pointer vers une instance de développement locale.
            </p>

            <div className="flex items-center gap-3">
              <Button type="submit" size="sm">
                Enregistrer
              </Button>
              {saved ? (
                <span className="text-xs text-emerald-300">Enregistré</span>
              ) : null}
            </div>

            {error ? <SettingsError>{error}</SettingsError> : null}
          </form>
        </Card>

        <Card>
          <SettingsCardTitle>À propos</SettingsCardTitle>
          <dl className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
            <dt className="text-nexus-muted">Version</dt>
            <dd className="font-mono text-xs text-nexus-white">
              {version || "—"}
            </dd>
          </dl>
        </Card>
      </div>
    </section>
  );
}
