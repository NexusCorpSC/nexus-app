import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "@/auth/auth-context";
import {
  ALLOWED_API_BASE_URLS,
  DEFAULT_API_BASE_URL,
  DEFAULT_SHORTCUTS,
  getApiBaseUrl,
  getShortcuts,
  isAllowedBaseUrl,
  normalizeBaseUrl,
  setApiBaseUrl,
  setShortcuts,
  type Shortcuts,
} from "@/lib/settings";
import { Button, Card, Field, Input, PageHeader } from "@/components/ui";
import { ShortcutInput } from "@/components/shortcut-input";

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
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const shortcutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void getApiBaseUrl().then(setBaseUrl);
    void getVersion().then(setVersion);
    void getShortcuts().then(setLocalShortcuts);
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
   * Binds first, persists second: if the combination is already taken by
   * another application, nothing is written and the previous pair stays live.
   */
  async function handleShortcutsSubmit(event: FormEvent) {
    event.preventDefault();
    setShortcutError(null);

    try {
      await invoke("set_shortcuts", {
        search: shortcuts.search,
        capture: shortcuts.capture,
      });
    } catch (cause) {
      setShortcutError(String(cause));
      return;
    }

    await setShortcuts(shortcuts);
    setShortcutsSaved(true);
    if (shortcutTimer.current) clearTimeout(shortcutTimer.current);
    shortcutTimer.current = setTimeout(() => setShortcutsSaved(false), 2500);
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
        </form>
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
