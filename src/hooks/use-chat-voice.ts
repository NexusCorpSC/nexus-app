import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelRecording,
  SpeechPlayer,
  speech,
  splitForSpeech,
  startRecording,
  stopRecording,
  transcribe,
  VoiceFailure,
  wavSeconds,
  type VoiceError,
} from "@/lib/chat-voice";

/** Past this, the key (or button) was held: letting go sends. */
const HOLD_MS = 400;

/** The longest recording the site takes. */
const MAX_SECONDS = 60;

/** Shorter than this, it was only a tap on the key. */
const MIN_SECONDS = 0.3;

/** Whether answers are read aloud, the player's choice on this computer. */
const READ_ALOUD_KEY = "nexus-chat-read-aloud";

export type VoiceState = "idle" | "recording" | "transcribing";

function readAloudStored(): boolean {
  try {
    return window.localStorage.getItem(READ_ALOUD_KEY) !== "off";
  } catch {
    return true;
  }
}

/**
 * Talking to Nexus Chat: push to talk (hold then let go to send, or tap once
 * to start and once to finish), and the answers read aloud. Owned by the page
 * rather than the conversation: the talk shortcut may come before the
 * conversation is loaded, and what was said waits for it (`transcript`).
 */
export function useChatVoice({
  conversationId,
  onRemaining,
}: {
  /** The conversation the cost is filed under. */
  conversationId: string | undefined;
  /** What is left of this month's budget after a voice call. */
  onRemaining: (remainingMicros: number) => void;
}) {
  const [state, setState] = useState<VoiceState>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<VoiceError | null>(null);
  const [readAloud, setReadAloudState] = useState(readAloudStored);
  /** The last thing said, for the conversation to send; `key` tells repeats apart. */
  const [transcript, setTranscript] = useState<{
    text: string;
    key: number;
  } | null>(null);
  const stateRef = useRef<VoiceState>("idle");
  const pressedAt = useRef(0);
  const starting = useRef<Promise<void> | null>(null);
  /** The recording being closed and transcribed, until `voice_stop` is back. */
  const stopping = useRef<Promise<unknown> | null>(null);
  const player = useRef<SpeechPlayer | null>(null);
  const latest = useRef({ conversationId, onRemaining });

  useEffect(() => {
    latest.current = { conversationId, onRemaining };
  });

  useEffect(() => {
    const current = new SpeechPlayer(setSpeaking);
    player.current = current;
    return () => {
      current.stop();
      if (stateRef.current === "recording") void cancelRecording();
    };
  }, []);

  const update = useCallback((next: VoiceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const finish = useCallback(async () => {
    if (stateRef.current !== "recording") return;
    await starting.current?.catch(() => {});
    if (stateRef.current !== "recording") return;
    update("transcribing");
    try {
      const stopped = stopRecording();
      stopping.current = stopped.catch(() => {});
      const wav = await stopped;
      if (wavSeconds(wav) < MIN_SECONDS) {
        setError("too_short");
        return;
      }
      const { text, remainingMicros } = await transcribe(
        wav,
        latest.current.conversationId ?? "voice",
      );
      if (remainingMicros !== undefined) {
        latest.current.onRemaining(remainingMicros);
      }
      if (!text) setError("nothing_heard");
      else setTranscript((current) => ({ text, key: (current?.key ?? 0) + 1 }));
    } catch (cause) {
      setError(cause instanceof VoiceFailure ? cause.code : "generic");
    } finally {
      update("idle");
    }
  }, [update]);

  /**
   * The key or the button went down. `opened` is the talk shortcut, which
   * opened the microphone itself (`error` when it could not).
   */
  const press = useCallback(
    async (opened?: { error?: string | null }) => {
      player.current?.stop();
      if (stateRef.current === "recording") {
        // The second tap of "once to start, once to finish".
        void finish();
        return;
      }
      if (stateRef.current !== "idle") {
        // The shortcut opened the microphone while what was said is still
        // being sent: closed once `voice_stop` has taken the recording, not
        // before — that would drop what the player just said.
        if (opened) {
          void (stopping.current ?? Promise.resolve()).then(() =>
            cancelRecording(),
          );
        }
        return;
      }
      setError(null);
      if (opened?.error) {
        setError(opened.error === "busy" ? "mic_in_use" : "mic_failed");
        return;
      }
      pressedAt.current = Date.now();
      update("recording");
      // The site takes a minute at most: past it, what was said goes out.
      const startedAt = pressedAt.current;
      setTimeout(() => {
        if (pressedAt.current === startedAt) void finish();
      }, MAX_SECONDS * 1000);
      starting.current = opened ? Promise.resolve() : startRecording();
      try {
        await starting.current;
      } catch (cause) {
        update("idle");
        setError(cause instanceof VoiceFailure ? cause.code : "mic_failed");
      }
    },
    [finish, update],
  );

  /** The key or the button went up: sends if it was held. */
  const release = useCallback(() => {
    if (stateRef.current !== "recording") return;
    if (Date.now() - pressedAt.current >= HOLD_MS) void finish();
  }, [finish]);

  /** Drops the recording under way (Escape). */
  const cancel = useCallback(() => {
    if (stateRef.current !== "recording") return false;
    void cancelRecording();
    update("idle");
    return true;
  }, [update]);

  const speak = useCallback((text: string) => {
    const chunks = splitForSpeech(text);
    if (chunks.length === 0) return;
    void player.current?.play(chunks, async (chunk, signal) => {
      try {
        const { audio, remainingMicros } = await speech(
          chunk,
          latest.current.conversationId ?? "voice",
          signal,
        );
        if (remainingMicros !== undefined && Number.isFinite(remainingMicros)) {
          latest.current.onRemaining(remainingMicros);
        }
        return audio;
      } catch (cause) {
        if (!signal.aborted) {
          setError(cause instanceof VoiceFailure ? cause.code : "generic");
        }
        return null;
      }
    });
  }, []);

  const stopSpeaking = useCallback(() => player.current?.stop(), []);

  /** What was said, for the conversation to send — once. */
  const transcriptRef = useRef(transcript);
  useEffect(() => {
    transcriptRef.current = transcript;
  });
  const takeTranscript = useCallback(() => {
    const text = transcriptRef.current?.text ?? null;
    transcriptRef.current = null;
    setTranscript(null);
    return text;
  }, []);

  const setReadAloud = useCallback((on: boolean) => {
    setReadAloudState(on);
    if (!on) player.current?.stop();
    try {
      window.localStorage.setItem(READ_ALOUD_KEY, on ? "on" : "off");
    } catch {
      // No storage: the choice holds for this window.
    }
  }, []);

  return {
    state,
    speaking,
    error,
    clearError: useCallback(() => setError(null), []),
    readAloud,
    setReadAloud,
    transcript,
    takeTranscript,
    press,
    release,
    cancel,
    speak,
    stopSpeaking,
  };
}

export type ChatVoice = ReturnType<typeof useChatVoice>;
