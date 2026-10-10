import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { useLocale, useTranslations } from "use-intl";
import {
  ArrowUp,
  Loader2,
  Mic,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui";
import { ChatMessage } from "@/components/chat/chat-message";
import { resetDate } from "@/components/chat/chat-budget";
import type { ChatVoice } from "@/hooks/use-chat-voice";
import { chatErrorCode, chatFetch, requestChatStop } from "@/lib/api/chat";
import { speechText, textPartCount } from "@/lib/chat-voice";
import { cn } from "@/lib/utils";
import {
  CHAT_MESSAGE_MAX_LENGTH,
  type ChatStatus,
  type ChatUIMessage,
  withRemaining,
} from "@/types/chat";

/** Whether the message holds a write the player confirmed: it was made. */
function hasConfirmedWrite(message: ChatUIMessage): boolean {
  return message.parts.some(
    (part) =>
      isToolUIPart(part) &&
      "approval" in part &&
      part.approval?.approved === true,
  );
}

/**
 * The conversations whose current turn started by voice: the answer is made
 * for speaking and read aloud (confirmations included).
 */
const voiceTurns = new Set<string>();

/**
 * One Nexus Chat conversation: the messages, the input, the confirmations.
 * The site keeps the history: each request sends only the last message (the
 * player's new one, or their answers to the confirmations). The same as the
 * site's `components/chat/chat-view.tsx`, through the HTTP plugin.
 *
 * With `voice` (and voice open on the site), the player can also talk: what
 * they said is sent as their message, and the answer is read aloud.
 */
export function ChatView({
  id,
  initialMessages,
  status,
  onStatus,
  onSaved,
  compact = false,
  focusSignal = 0,
  onBusyChange,
  voice,
}: {
  id: string;
  initialMessages: ChatUIMessage[];
  status: ChatStatus;
  onStatus: (update: (status: ChatStatus) => ChatStatus) => void;
  /** An answer is over (and saved): the list can be read again. */
  onSaved?: (id: string, savedAt?: string) => void;
  compact?: boolean;
  /** Bumped to put the cursor back in the input (the overlay coming up). */
  focusSignal?: number;
  /** Whether an answer is on its way, for a caller that must not swap it out. */
  onBusyChange?: (busy: boolean) => void;
  /** Talking to the chat, owned by the page (`useChatVoice`). */
  voice?: ChatVoice;
}) {
  const t = useTranslations("Chat");
  const locale = useLocale();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // The text parts already read, by message: after a confirmation the rest of
  // the answer is read without going over the start again.
  const spoken = useRef(new Map<string, number>());
  const voiceRef = useRef(voice);

  useEffect(() => {
    voiceRef.current = voice;
  });

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: "/api/chat",
        fetch: chatFetch,
        prepareSendMessagesRequest: ({ id: chatId, messages }) => ({
          body: {
            id: chatId,
            message: messages[messages.length - 1],
            ...(voiceTurns.has(chatId) && { voice: true }),
          },
        }),
      }),
    [],
  );

  const {
    messages,
    sendMessage,
    addToolApprovalResponse,
    regenerate,
    stop,
    status: chatStatus,
    error,
    clearError,
  } = useChat<ChatUIMessage>({
    id,
    messages: initialMessages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: ({ message, isError, isAbort, isDisconnect }) => {
      const reader = voiceRef.current;
      // An answer the player stopped, or that was cut off, is not read.
      const complete = !isError && !isAbort && !isDisconnect;
      if (complete && voiceTurns.has(id) && reader?.readAloud) {
        const from = spoken.current.get(message.id) ?? 0;
        spoken.current.set(message.id, textPartCount(message));
        reader.speak(speechText(message, from));
      }
      const remaining = message.metadata?.remainingMicros;
      if (remaining !== undefined) {
        onStatus(withRemaining(remaining));
      }
      if (!isError) onSaved?.(id, message.metadata?.savedAt);
    },
    onError: (cause) => {
      const code = chatErrorCode(cause);
      if (code === "budget_exhausted") {
        onStatus((current) => ({
          ...current,
          remainingMicros: 0,
          spentMicros: current.monthlyBudgetMicros,
        }));
      } else if (code === "disabled") {
        onStatus((current) => ({ ...current, enabled: false }));
      } else if (code === "no_access") {
        onStatus((current) => ({ ...current, status: "revoked" }));
      }
    },
  });

  const busy = chatStatus === "submitted" || chatStatus === "streaming";
  const exhausted = status.remainingMicros <= 0;
  const voiceOpen = Boolean(voice && status.voice);
  const canTalk = voiceOpen && !exhausted && !busy;
  const errorCode = error ? chatErrorCode(error) : null;
  const last = messages[messages.length - 1];
  // Retrying replays the turn: not once it made a confirmed write (an order
  // twice).
  const canRetry =
    (errorCode === "generic" ||
      errorCode === "unavailable" ||
      errorCode === "busy") &&
    !(last?.role === "assistant" && hasConfirmedWrite(last));
  const pendingApproval = last?.parts.some(
    (part) => "state" in part && part.state === "approval-requested",
  );

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, chatStatus]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [id, focusSignal]);

  useEffect(
    () => () => {
      voiceTurns.delete(id);
    },
    [id],
  );

  // What the player said goes out as their message, once the answer before
  // it is over.
  const takeTranscript = voice?.takeTranscript;
  const hasTranscript = Boolean(voice?.transcript);
  useEffect(() => {
    if (!hasTranscript || !takeTranscript || busy || exhausted) return;
    const text = takeTranscript();
    if (!text) return;
    clearError();
    voiceTurns.add(id);
    void sendMessage({ text });
  }, [
    busy,
    clearError,
    exhausted,
    hasTranscript,
    id,
    sendMessage,
    takeTranscript,
  ]);

  function submit(event?: React.FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || busy || exhausted) return;
    clearError();
    voice?.clearError();
    voiceTurns.delete(id);
    voice?.stopSpeaking();
    void sendMessage({ text });
    setInput("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          "min-h-0 flex-1 space-y-4 overflow-y-auto",
          compact ? "p-3" : "p-4",
        )}
        aria-live="polite"
      >
        {messages.length === 0 && (
          <div className="mx-auto max-w-md space-y-2 py-8 text-center text-[13px] text-nexus-muted">
            <p className="font-semibold text-nexus-white">{t("emptyTitle")}</p>
            <p>{t("emptyHint")}</p>
          </div>
        )}
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            disabled={busy}
            onApproval={(approvalId, approved) =>
              void addToolApprovalResponse({ id: approvalId, approved })
            }
          />
        ))}
        {chatStatus === "submitted" && (
          <p className="flex items-center gap-2 text-xs text-nexus-muted">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {t("thinking")}
          </p>
        )}
        {last?.metadata?.budgetExhausted && (
          <p className="text-xs text-amber-200">{t("stoppedBudget")}</p>
        )}
        {voice?.error && (
          <p className="text-xs text-amber-200" role="status">
            {t(`voice.errors.${voice.error}`)}
          </p>
        )}
        {errorCode && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-950/30 px-3 py-2 text-[13px] text-red-200">
            <span>{t(`errors.${errorCode}`)}</span>
            {canRetry && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  clearError();
                  void regenerate();
                }}
              >
                <RotateCcw className="size-3.5" aria-hidden />
                {t("retry")}
              </Button>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={submit}
        className={cn(
          "border-t border-nexus-accent/12",
          compact ? "p-2" : "p-3",
        )}
      >
        {exhausted ? (
          <p className="px-1 py-2 text-[13px] text-amber-200">
            {t("budget.exhausted", { date: resetDate(status, locale) })}
          </p>
        ) : (
          <div className="space-y-2">
            {voiceOpen && voice && voice.state !== "idle" && (
              <p
                className="flex items-center gap-2 px-1 text-xs text-nexus-accent"
                role="status"
              >
                {voice.state === "recording" ? (
                  <span className="size-2 animate-pulse rounded-full bg-red-400" />
                ) : (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                )}
                {t(`voice.${voice.state}`)}
              </p>
            )}
            <div className="flex items-end gap-2">
              {voiceOpen && voice && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-9.5 px-0"
                  onClick={() => voice.setReadAloud(!voice.readAloud)}
                  aria-pressed={voice.readAloud}
                  aria-label={t(
                    voice.readAloud
                      ? "voice.readAloudOn"
                      : "voice.readAloudOff",
                  )}
                  title={t(
                    voice.readAloud
                      ? "voice.readAloudOn"
                      : "voice.readAloudOff",
                  )}
                >
                  {voice.readAloud ? (
                    <Volume2 className="size-4" aria-hidden />
                  ) : (
                    <VolumeX className="size-4" aria-hidden />
                  )}
                </Button>
              )}
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    submit();
                  }
                }}
                rows={1}
                maxLength={CHAT_MESSAGE_MAX_LENGTH}
                placeholder={
                  pendingApproval ? t("placeholderApproval") : t("placeholder")
                }
                aria-label={t("placeholder")}
                className="field-sizing-content max-h-40 min-h-9.5 flex-1 resize-none rounded-lg border border-nexus-accent/15 bg-nexus-card px-3 py-2 text-[13.5px] text-nexus-white placeholder:text-nexus-dim/80 focus:border-nexus-accent/50 focus:outline-none"
              />
              {voiceOpen &&
                voice &&
                (voice.speaking ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-9.5 px-0"
                    onClick={voice.stopSpeaking}
                    aria-label={t("voice.stopSpeaking")}
                    title={t("voice.stopSpeaking")}
                  >
                    <VolumeX className="size-4" aria-hidden />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant={voice.state === "recording" ? "danger" : "outline"}
                    className="w-9.5 px-0"
                    disabled={!canTalk || voice.state === "transcribing"}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.currentTarget.setPointerCapture(event.pointerId);
                      void voice.press();
                    }}
                    onPointerUp={() => voice.release()}
                    onPointerCancel={() => voice.release()}
                    onKeyDown={(event) => {
                      if (
                        (event.key === " " || event.key === "Enter") &&
                        !event.repeat
                      ) {
                        event.preventDefault();
                        void voice.press();
                      }
                    }}
                    onKeyUp={(event) => {
                      if (event.key === " " || event.key === "Enter") {
                        voice.release();
                      }
                    }}
                    aria-pressed={voice.state === "recording"}
                    aria-label={t("voice.talk")}
                    title={t("voice.talkHint")}
                  >
                    <Mic className="size-4" aria-hidden />
                  </Button>
                ))}
              {busy ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-9.5 px-0"
                  onClick={() => {
                    void stop();
                    void requestChatStop().catch(() => {});
                  }}
                  aria-label={t("stop")}
                  title={t("stop")}
                >
                  <Square className="size-4" aria-hidden />
                </Button>
              ) : (
                <Button
                  type="submit"
                  className="w-9.5 px-0"
                  disabled={!input.trim()}
                  aria-label={t("send")}
                  title={t("send")}
                >
                  <ArrowUp className="size-4" aria-hidden />
                </Button>
              )}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
