import { invoke } from "@tauri-apps/api/core";
import { isTextUIPart, type UIMessage } from "ai";
import { chatFetch } from "@/lib/api/chat";

/**
 * Talking to Nexus Chat: the microphone is read by Rust (`src-tauri/src/
 * voice.rs`), the site transcribes what it heard (`POST /api/chat/transcribe`)
 * and reads answers aloud one chunk at a time (`POST /api/chat/speech`). The
 * same rules as the site's `lib/chat/voice-client.ts`.
 */

/** Longest chunk the site reads in one go (`CHAT_SPEECH_MAX_LENGTH`). */
const SPEECH_MAX_LENGTH = 1000;

/**
 * Opens the microphone; does nothing when it is already open. Fails with
 * `mic_in_use` when the other window is recording.
 */
export async function startRecording(): Promise<void> {
  try {
    await invoke("voice_start");
  } catch (cause) {
    throw new VoiceFailure(
      String(cause) === "busy" ? "mic_in_use" : "mic_failed",
    );
  }
}

/**
 * Closes the microphone and returns what it heard: a 16 kHz mono WAV. The
 * talk shortcut opens it without waiting: that it did not open comes out here.
 */
export async function stopRecording(): Promise<ArrayBuffer> {
  try {
    return await invoke<ArrayBuffer>("voice_stop");
  } catch (cause) {
    const reason = String(cause);
    throw new VoiceFailure(
      reason === "microphone_silent"
        ? "mic_silent"
        : reason.startsWith("microphone") || reason.startsWith("no_microphone")
          ? "mic_failed"
          : "generic",
    );
  }
}

/** A microphone the player can choose in Settings. */
export interface Microphone {
  id: string;
  name: string;
}

/** The microphones plugged in right now (none outside Windows). */
export function listMicrophones(): Promise<Microphone[]> {
  return invoke<Microphone[]>("voice_input_devices");
}

/**
 * Listens to `id` from the next recording on, or to the system's default
 * microphone (`null`). Persisting the choice is `settings.ts`'s.
 */
export function applyMicrophone(id: string | null): Promise<void> {
  return invoke("voice_set_input_device", { id });
}

/** Closes the microphone, keeping nothing. */
export function cancelRecording(): Promise<void> {
  return invoke("voice_cancel");
}

/** The loudest sample of a 16-bit WAV, as a fraction of full scale. */
export function wavPeak(wav: ArrayBuffer): number {
  const samples = new Int16Array(
    wav.slice(44, 44 + ((wav.byteLength - 44) & ~1)),
  );
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak / 32768;
}

/**
 * Readings are numbered across the window and its reloads (hence the clock):
 * Rust keeps the last one stopped for each window, and refuses older ones.
 */
let lastGeneration = Date.now();

function nextGeneration(): number {
  return ++lastGeneration;
}

/** Plays a WAV through Rust, to the end. */
export function playWav(wav: ArrayBuffer): Promise<void> {
  return invoke("voice_play", new Uint8Array(wav), {
    headers: { "Speech-Generation": String(nextGeneration()) },
  });
}

/** Seconds of audio in a 16-bit mono WAV at 16 kHz. */
export function wavSeconds(wav: ArrayBuffer): number {
  return Math.max(0, wav.byteLength - 44) / (16_000 * 2);
}

/** What went wrong, as the site names it (`ChatVoiceErrorCode`) or here. */
export type VoiceError =
  | "unauthorized"
  | "disabled"
  | "no_access"
  | "budget_exhausted"
  | "invalid_request"
  | "not_found"
  | "busy"
  | "unavailable"
  | "voice_disabled"
  | "too_short"
  | "too_long"
  | "mic_failed"
  | "mic_in_use"
  | "mic_silent"
  | "nothing_heard"
  | "generic";

const KNOWN: VoiceError[] = [
  "unauthorized",
  "disabled",
  "no_access",
  "budget_exhausted",
  "invalid_request",
  "not_found",
  "busy",
  "unavailable",
  "voice_disabled",
  "too_short",
  "too_long",
];

export class VoiceFailure extends Error {
  constructor(readonly code: VoiceError) {
    super(code);
  }
}

async function failure(response: Response): Promise<VoiceFailure> {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  const code = body?.error;
  return new VoiceFailure(
    KNOWN.includes(code as VoiceError) ? (code as VoiceError) : "generic",
  );
}

/** What the player said, and what is left of this month's budget. */
export async function transcribe(
  wav: ArrayBuffer,
  conversationId: string,
): Promise<{ text: string; remainingMicros?: number }> {
  const response = await chatFetch(
    `/api/chat/transcribe?id=${encodeURIComponent(conversationId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: new Uint8Array(wav),
    },
  );
  if (!response.ok) throw await failure(response);
  const body = (await response.json()) as {
    text?: string;
    remainingMicros?: number;
  };
  return {
    text: body.text?.trim() ?? "",
    remainingMicros: body.remainingMicros,
  };
}

/** One chunk of an answer, read aloud by the site. */
export async function speech(
  text: string,
  conversationId: string,
  signal: AbortSignal,
): Promise<{ audio: Blob; remainingMicros?: number }> {
  const response = await chatFetch(
    `/api/chat/speech?id=${encodeURIComponent(conversationId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    },
  );
  if (!response.ok) throw await failure(response);
  const remaining = Number(response.headers.get("X-Chat-Remaining-Micros"));
  return {
    audio: await response.blob(),
    remainingMicros: response.headers.has("X-Chat-Remaining-Micros")
      ? remaining
      : undefined,
  };
}

/**
 * The text of an answer to read: its text parts from `from` on, without the
 * Markdown (links kept by their label, no tables, no code blocks).
 */
export function speechText(message: UIMessage, from = 0): string {
  return message.parts
    .filter(isTextUIPart)
    .slice(from)
    .map((part) => plainText(part.text))
    .filter(Boolean)
    .join("\n");
}

/** How many text parts the message has: where reading picks up next time. */
export function textPartCount(message: UIMessage): number {
  return message.parts.filter(isTextUIPart).length;
}

export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .split("\n")
    .filter((line) => !/^\s*\|/.test(line))
    .join("\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, "$2")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Cuts a text into chunks to read, at sentence ends: a short first one, to
 * start speaking quickly, longer ones after.
 */
export function splitForSpeech(text: string): string[] {
  const sentences = text.match(/[^.!?…\n]+[.!?…]*\s*|\n/g) ?? [];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const limit = chunks.length === 0 ? 160 : 450;
    if (current && (current + sentence).length > limit) {
      chunks.push(current.trim());
      current = "";
    }
    current += sentence;
    while (current.length > SPEECH_MAX_LENGTH) {
      const space = current.lastIndexOf(" ", SPEECH_MAX_LENGTH);
      const cut = space > 0 ? space : SPEECH_MAX_LENGTH;
      chunks.push(current.slice(0, cut).trim());
      current = current.slice(cut);
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

/**
 * Reads chunks of text one after the other, the next one being prepared while
 * the previous one plays. `fetchAudio` returns a chunk's audio (or `null` to
 * stop there). A new `play` or a `stop` cuts off what was playing.
 */
export class SpeechPlayer {
  private generation = nextGeneration();
  private controller: AbortController | null = null;

  constructor(private readonly onSpeaking: (speaking: boolean) => void) {}

  async play(
    chunks: string[],
    fetchAudio: (text: string, signal: AbortSignal) => Promise<Blob | null>,
  ): Promise<void> {
    this.stop();
    if (chunks.length === 0) return;
    const generation = (this.generation = nextGeneration());
    const controller = new AbortController();
    this.controller = controller;
    this.onSpeaking(true);
    const fetchOne = (text: string) =>
      fetchAudio(text, controller.signal).catch(() => null);
    try {
      let next = fetchOne(chunks[0]);
      for (let i = 0; i < chunks.length; i++) {
        const blob = await next;
        if (generation !== this.generation || !blob) return;
        if (i + 1 < chunks.length) next = fetchOne(chunks[i + 1]);
        if (!(await this.playBlob(blob, generation))) return;
        if (generation !== this.generation) return;
      }
    } finally {
      if (generation === this.generation) {
        this.controller = null;
        this.onSpeaking(false);
      }
    }
  }

  /** Whether to go on: not when the other window's reading took over. */
  private async playBlob(blob: Blob, generation: number): Promise<boolean> {
    if (generation !== this.generation) return false;
    // Played by Rust (`voice_play`): over a game the webview never gets the
    // click its autoplay policy waits for. The generation lets a `stop` that
    // overtakes this call still cut it off.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (generation !== this.generation) return false;
    return invoke("voice_play", bytes, {
      headers: { "Speech-Generation": String(generation) },
    }).then(
      () => true,
      (cause) => String(cause) !== "interrupted",
    );
  }

  stop(): void {
    const wasPlaying = this.controller !== null;
    this.generation = nextGeneration();
    this.controller?.abort();
    this.controller = null;
    if (wasPlaying) {
      void invoke("voice_stop_playback", {
        generation: this.generation,
      }).catch(() => {});
      this.onSpeaking(false);
    }
  }
}
