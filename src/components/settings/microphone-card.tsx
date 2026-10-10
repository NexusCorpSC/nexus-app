import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { Button, Card, Field, Select } from "@/components/ui";
import {
  SettingsCardTitle,
  SettingsError,
} from "@/components/settings/section-header";
import {
  applyMicrophone,
  listMicrophones,
  playWav,
  startRecording,
  stopRecording,
  VoiceFailure,
  wavPeak,
  type Microphone,
} from "@/lib/chat-voice";
import { getMicrophone, setMicrophone } from "@/lib/settings";

/** The option standing for the system's default microphone. */
const SYSTEM_DEFAULT = "";

/** How long the test records. */
const TEST_SECONDS = 3;

/** Below this peak, the test says next to nothing was picked up. */
const QUIET_PEAK = 0.02;

type TestState = "idle" | "recording" | "playing";

/** What the test heard, or why it heard nothing. */
type TestResult =
  | { kind: "level"; percent: number; quiet: boolean }
  | { kind: "error"; key: "testSilent" | "testInUse" | "testFailed" };

/**
 * The microphone Nexus Chat listens to. A chosen one that is unplugged stays
 * chosen (and listed as such): the system's default stands in for it until
 * it is back.
 */
export function MicrophoneCard() {
  const t = useTranslations("Settings.microphone");
  const [chosen, setChosen] = useState<string>(SYSTEM_DEFAULT);
  /** `null` until listed: no microphone is called unplugged before that. */
  const [microphones, setMicrophones] = useState<Microphone[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void listMicrophones()
      .then((listed) => {
        setMicrophones(listed);
        setError(null);
      })
      .catch((cause) => {
        console.error("[settings] cannot list the microphones", cause);
        setError(t("listError"));
      });
  }, [t]);

  // A choice made before the stored one is read wins over it.
  const touched = useRef(false);

  useEffect(() => {
    void getMicrophone()
      .then((id) => {
        if (!touched.current) setChosen(id ?? SYSTEM_DEFAULT);
      })
      .catch((cause) => {
        console.error("[settings] cannot read the microphone", cause);
        setError(t("readError"));
      });
    refresh();
  }, [refresh, t]);

  async function handleChange(next: string) {
    touched.current = true;
    const previous = chosen;
    setChosen(next);
    setError(null);
    const id = next === SYSTEM_DEFAULT ? null : next;
    try {
      // Applied before it is stored: a choice Rust refuses must not come
      // back at the next start.
      await applyMicrophone(id);
      await setMicrophone(id);
    } catch (cause) {
      setChosen(previous);
      setError(cause instanceof Error ? cause.message : t("saveError"));
    }
  }

  const [testState, setTestState] = useState<TestState>("idle");
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  /**
   * Records a few seconds with the chosen microphone, says how loud it was,
   * and plays it back: the quickest way to tell a muted or wrong microphone
   * from a transcription problem.
   */
  async function handleTest() {
    setTestResult(null);
    setTestState("recording");
    try {
      await startRecording();
      await new Promise((resolve) => setTimeout(resolve, TEST_SECONDS * 1000));
      const wav = await stopRecording();
      const peak = wavPeak(wav);
      setTestResult({
        kind: "level",
        percent: Math.round(peak * 100),
        quiet: peak < QUIET_PEAK,
      });
      setTestState("playing");
      await playWav(wav).catch(() => {});
    } catch (cause) {
      const code = cause instanceof VoiceFailure ? cause.code : "generic";
      setTestResult({
        kind: "error",
        key:
          code === "mic_silent"
            ? "testSilent"
            : code === "mic_in_use"
              ? "testInUse"
              : "testFailed",
      });
    } finally {
      setTestState("idle");
    }
  }

  const missing =
    chosen !== SYSTEM_DEFAULT &&
    microphones !== null &&
    !microphones.some((microphone) => microphone.id === chosen);
  // Before the list is in, the chosen one is still offered, under its id's
  // stand-in label rather than as unplugged.
  const pending = chosen !== SYSTEM_DEFAULT && microphones === null;

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
              {(microphones ?? []).map((microphone) => (
                <option key={microphone.id} value={microphone.id}>
                  {microphone.name}
                </option>
              ))}
              {missing ? <option value={chosen}>{t("missing")}</option> : null}
              {pending ? <option value={chosen}>{t("loading")}</option> : null}
            </Select>
          </Field>
          <Button type="button" size="sm" variant="outline" onClick={refresh}>
            {t("refresh")}
          </Button>
        </div>
        <p className="text-[11.5px] text-nexus-dim">
          {missing ? t("missingHint") : t("hint")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={testState !== "idle"}
            onClick={() => void handleTest()}
          >
            {t("test")}
          </Button>
          <span className="text-[12px] text-nexus-muted" aria-live="polite">
            {testState === "recording"
              ? t("testRecording", { seconds: TEST_SECONDS })
              : testState === "playing"
                ? t("testPlaying")
                : testResult?.kind === "level"
                  ? t("testLevel", { percent: testResult.percent })
                  : null}
          </span>
        </div>
        {testResult?.kind === "level" && testResult.quiet ? (
          <SettingsError>{t("testQuiet")}</SettingsError>
        ) : null}
        {testResult?.kind === "error" ? (
          <SettingsError>{t(testResult.key)}</SettingsError>
        ) : null}
        {error ? <SettingsError>{error}</SettingsError> : null}
      </div>
    </Card>
  );
}
