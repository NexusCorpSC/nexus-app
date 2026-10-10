import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { Button, Card, Field, Select } from "@/components/ui";
import {
  SettingsCardTitle,
  SettingsError,
} from "@/components/settings/section-header";
import {
  applyMicrophone,
  listMicrophones,
  type Microphone,
} from "@/lib/chat-voice";
import { getMicrophone, setMicrophone } from "@/lib/settings";

/** The option standing for the system's default microphone. */
const SYSTEM_DEFAULT = "";

/**
 * The microphone Nexus Chat listens to. A chosen one that is unplugged stays
 * chosen (and listed as such): the system's default stands in for it until
 * it is back.
 */
export function MicrophoneCard() {
  const t = useTranslations("Settings.microphone");
  const [chosen, setChosen] = useState<string>(SYSTEM_DEFAULT);
  const [microphones, setMicrophones] = useState<Microphone[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void listMicrophones()
      .then(setMicrophones)
      .catch((cause) => {
        console.error("[settings] cannot list the microphones", cause);
        setError(t("listError"));
      });
  }, [t]);

  useEffect(() => {
    void getMicrophone().then((id) => setChosen(id ?? SYSTEM_DEFAULT));
    refresh();
  }, [refresh]);

  async function handleChange(next: string) {
    const previous = chosen;
    setChosen(next);
    setError(null);
    const id = next === SYSTEM_DEFAULT ? null : next;
    try {
      await setMicrophone(id);
      await applyMicrophone(id);
    } catch (cause) {
      setChosen(previous);
      setError(cause instanceof Error ? cause.message : t("saveError"));
    }
  }

  const missing =
    chosen !== SYSTEM_DEFAULT &&
    !microphones.some((microphone) => microphone.id === chosen);

  return (
    <Card>
      <SettingsCardTitle>{t("title")}</SettingsCardTitle>
      <div className="space-y-3 p-4">
        <div className="flex items-end gap-2">
          <Field label={t("label")} className="flex-1">
            <Select
              value={chosen}
              onChange={(event) => void handleChange(event.target.value)}
            >
              <option value={SYSTEM_DEFAULT}>{t("systemDefault")}</option>
              {microphones.map((microphone) => (
                <option key={microphone.id} value={microphone.id}>
                  {microphone.name}
                </option>
              ))}
              {missing ? <option value={chosen}>{t("missing")}</option> : null}
            </Select>
          </Field>
          <Button type="button" size="sm" variant="outline" onClick={refresh}>
            {t("refresh")}
          </Button>
        </div>
        <p className="text-[11.5px] text-nexus-dim">
          {missing ? t("missingHint") : t("hint")}
        </p>
        {error ? <SettingsError>{error}</SettingsError> : null}
      </div>
    </Card>
  );
}
