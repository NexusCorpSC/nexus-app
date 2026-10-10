import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslations } from "use-intl";
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
import { LanguageCard } from "@/components/settings/language-card";
import { MicrophoneCard } from "@/components/settings/microphone-card";

/**
 * The language, the microphone Nexus Chat listens to, the instance the app
 * talks to, and what the app itself is.
 */
export function GeneralSection() {
  const t = useTranslations("Settings.general");
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

  // Clears the "saved" flash timer if the screen is left first.
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
      setError(t("urlNotAllowed", { allowed: ALLOWED_API_BASE_URLS.join(", ") }));
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
        title={t("title")}
        description={t("description")}
      />

      <div className="space-y-4">
        <LanguageCard />

        <MicrophoneCard />

        <Card>
          <SettingsCardTitle>{t("instance")}</SettingsCardTitle>
          <form onSubmit={handleSubmit} className="space-y-4 p-4">
            <Field label={t("apiUrl")}>
              <Input
                value={baseUrl}
                placeholder={DEFAULT_API_BASE_URL}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </Field>

            <p className="text-[11.5px] text-nexus-dim">
              {t.rich("localHint", {
                url: () => (
                  <code className="font-mono text-nexus-muted">
                    http://localhost:3000
                  </code>
                ),
              })}
            </p>

            <div className="flex items-center gap-3">
              <Button type="submit" size="sm">
                {t("save")}
              </Button>
              {saved ? (
                <span className="text-xs text-emerald-300">{t("saved")}</span>
              ) : null}
            </div>

            {error ? <SettingsError>{error}</SettingsError> : null}
          </form>
        </Card>

        <Card>
          <SettingsCardTitle>{t("about")}</SettingsCardTitle>
          <dl className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
            <dt className="text-nexus-muted">{t("version")}</dt>
            <dd className="font-mono text-xs text-nexus-white">
              {version || "—"}
            </dd>
          </dl>
        </Card>
      </div>
    </section>
  );
}
