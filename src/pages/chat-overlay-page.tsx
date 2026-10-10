import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "use-intl";
import { AppWindow, Bot, MessageSquarePlus, X } from "lucide-react";
import { useAuth } from "@/auth/auth-context";
import { Button, ErrorState, LoadingState } from "@/components/ui";
import { ChatAccessPanel } from "@/components/chat/chat-access-panel";
import { ChatBudget } from "@/components/chat/chat-budget";
import { ChatView } from "@/components/chat/chat-view";
import { OverlayLockButton } from "@/components/overlay-lock-button";
import { OverlayOpacityButton } from "@/components/overlay-opacity-button";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useOverlayLocked } from "@/hooks/use-overlay-lock";
import { useOverlayMode } from "@/hooks/use-overlay-opacity";
import { useTransparentWindow } from "@/hooks/use-transparent-window";
import { CHAT_STATUS_KEY, getChatStatus } from "@/lib/api/chat";
import { openMainRoute } from "@/lib/main-window";
import { overlaySkin } from "@/lib/overlay-opacity";
import { cn } from "@/lib/utils";
import type { ChatStatus } from "@/types/chat";

/**
 * Nexus Chat over the game: the latest conversation, picked up where it was
 * left — in this window, the main one or on the site. It comes up with the
 * cursor in the input, and Escape puts it away, handing the keyboard back to
 * the game. It only talks to the site while it is on screen: when it is shown
 * (its window gains focus) and when the player sends something.
 */
export default function ChatOverlayPage() {
  const t = useTranslations("Chat");
  const { user, loading } = useAuth();
  const signedIn = Boolean(user);
  const queryClient = useQueryClient();
  const { active, startNew, load, markSaved, setBusy } = useActiveChat();
  const [focusSignal, setFocusSignal] = useState(0);

  useTransparentWindow();
  const mode = useOverlayMode("chat");
  const locked = useOverlayLocked("chat");

  const statusQuery = useQuery({
    queryKey: CHAT_STATUS_KEY,
    queryFn: getChatStatus,
    staleTime: 0,
    enabled: signedIn,
  });
  const status = statusQuery.data;
  const granted = status?.enabled && status.status === "granted";

  const resume = useCallback(async () => {
    try {
      if (!(await load("latest", { onlyIfNewer: true }))) {
        if (!active) startNew();
      }
    } catch {
      if (!active) startNew();
    }
  }, [active, load, startNew]);

  // First shown: the latest conversation. The windows are created hidden at
  // startup, so this waits for the first focus rather than the mount.
  useEffect(() => {
    const onFocus = () => {
      setFocusSignal((value) => value + 1);
      if (!signedIn) return;
      void statusQuery.refetch();
      void resume();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [resume, signedIn, statusQuery]);

  // Signed in while open, or a reload of the window while it is on screen.
  useEffect(() => {
    if (signedIn && granted && !active && document.hasFocus()) void resume();
  }, [active, granted, resume, signedIn]);

  const setStatus = useCallback(
    (update: ChatStatus | ((status: ChatStatus) => ChatStatus)) => {
      queryClient.setQueryData<ChatStatus>(CHAT_STATUS_KEY, (current) =>
        typeof update === "function" ? current && update(current) : update,
      );
    },
    [queryClient],
  );

  function close() {
    void invoke("close_chat_overlay");
  }

  // Escape puts the window away wherever the focus is — on the page itself
  // once a confirmation button it was on has gone.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        void invoke("close_chat_overlay");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function openInMain() {
    const route = active?.updatedAt
      ? `/chat?c=${encodeURIComponent(active.id)}`
      : "/chat";
    void openMainRoute(signedIn ? route : "/login");
  }

  return (
    <div
      className={cn(
        "flex h-screen w-screen flex-col overflow-hidden",
        overlaySkin(mode),
      )}
    >
      {/* The window has no decorations, so the header doubles as its title bar. */}
      <div
        data-tauri-drag-region
        className={cn(
          "flex shrink-0 cursor-grab items-center gap-1.5 px-3 py-2",
          mode === "opaque" ? "border-b border-white/10" : null,
        )}
      >
        <Bot className="pointer-events-none size-4 text-slate-400" />
        <p className="pointer-events-none flex-1 truncate text-sm font-medium text-slate-200">
          {t("title")}
        </p>
        {granted && (
          <button
            type="button"
            onClick={() => {
              startNew();
              setFocusSignal((value) => value + 1);
            }}
            title={t("newConversation")}
            className="rounded p-1 text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
          >
            <span className="sr-only">{t("newConversation")}</span>
            <MessageSquarePlus className="size-4" />
          </button>
        )}
        <button
          type="button"
          onClick={openInMain}
          title={t("openInMain")}
          className="rounded p-1 text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
        >
          <span className="sr-only">{t("openInMain")}</span>
          <AppWindow className="size-4" />
        </button>
        <OverlayOpacityButton label="chat" mode={mode} />
        <OverlayLockButton label="chat" locked={locked} />
        <button
          type="button"
          onClick={close}
          title={t("close")}
          className="rounded p-1 text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
        >
          <span className="sr-only">{t("close")}</span>
          <X className="size-4" />
        </button>
      </div>

      {granted && status && (
        <div className="shrink-0 px-3 pb-2">
          <ChatBudget status={status} compact />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {loading || (signedIn && statusQuery.isPending) ? (
          <LoadingState />
        ) : !signedIn ? (
          <div className="mx-auto max-w-sm space-y-3 px-4 py-10 text-center">
            <p className="text-sm font-semibold text-nexus-white">
              {t("signInTitle")}
            </p>
            <p className="text-[13px] text-nexus-muted">{t("signInBody")}</p>
            <Button onClick={() => void openMainRoute("/login")}>
              {t("signIn")}
            </Button>
          </div>
        ) : statusQuery.error || !status ? (
          <ErrorState
            error={statusQuery.error ?? new Error(t("loadFailed"))}
            onRetry={() => void statusQuery.refetch()}
          />
        ) : !granted ? (
          <div className="overflow-y-auto px-3">
            <ChatAccessPanel status={status} onStatus={setStatus} />
          </div>
        ) : active ? (
          <ChatView
            key={`${active.id}:${active.version}`}
            id={active.id}
            initialMessages={active.messages}
            status={status}
            onStatus={setStatus}
            onSaved={(id, savedAt) => void markSaved(id, savedAt)}
            onBusyChange={setBusy}
            focusSignal={focusSignal}
            compact
          />
        ) : (
          <LoadingState />
        )}
      </div>
    </div>
  );
}
