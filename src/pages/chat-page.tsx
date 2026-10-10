import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "use-intl";
import { Layers, MessageSquarePlus } from "lucide-react";
import { Button, ErrorState, LoadingState, PageHeader } from "@/components/ui";
import { ChatAccessPanel } from "@/components/chat/chat-access-panel";
import { ChatBudget } from "@/components/chat/chat-budget";
import { ChatConversations } from "@/components/chat/chat-conversations";
import { ChatView } from "@/components/chat/chat-view";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useChatVoice } from "@/hooks/use-chat-voice";
import {
  CHAT_CONVERSATIONS_KEY,
  CHAT_STATUS_KEY,
  deleteChatConversation,
  getChatStatus,
  listChatConversations,
  renameChatConversation,
} from "@/lib/api/chat";
import { showOverlay } from "@/lib/windows";
import type { ChatStatus } from "@/types/chat";

/**
 * Nexus Chat in the main window: the conversations on the left, the open one
 * on the right, and this month's budget — the site's `/chat`. The open
 * conversation is in the address (`?c=`), so the overlay can send one here.
 */
export default function ChatPage() {
  const t = useTranslations("Chat");
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("c");
  const { active, startNew, load, markSaved, setBusy } = useActiveChat();
  const [loadFailed, setLoadFailed] = useState(false);

  const statusQuery = useQuery({
    queryKey: CHAT_STATUS_KEY,
    queryFn: getChatStatus,
    staleTime: 0,
  });
  const granted =
    statusQuery.data?.enabled && statusQuery.data.status === "granted";
  const listQuery = useQuery({
    queryKey: CHAT_CONVERSATIONS_KEY,
    queryFn: listChatConversations,
    staleTime: 0,
    enabled: Boolean(granted),
  });

  // The conversation in the address — a click in the list, or the overlay
  // handing one over.
  useEffect(() => {
    setLoadFailed(false);
    if (!requested) {
      if (!active || active.updatedAt) startNew();
      return;
    }
    if (active?.id === requested) return;
    load(requested, { opened: true })
      .then((found) => setLoadFailed(!found))
      .catch(() => setLoadFailed(true));
    // Only the address decides; `active` is read, not followed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  // Back from the overlay or the site: the conversation may have gone on.
  useEffect(() => {
    const onFocus = () => {
      void queryClient.invalidateQueries({ queryKey: ["chat"] });
      if (active?.updatedAt) void load(active.id).catch(() => undefined);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [active, load, queryClient]);

  const setStatus = useCallback(
    (update: ChatStatus | ((status: ChatStatus) => ChatStatus)) => {
      queryClient.setQueryData<ChatStatus>(CHAT_STATUS_KEY, (current) =>
        typeof update === "function" ? current && update(current) : update,
      );
    },
    [queryClient],
  );

  const voice = useChatVoice({
    conversationId: active?.id,
    onRemaining: (remaining) =>
      setStatus((current) => ({
        ...current,
        remainingMicros: remaining,
        spentMicros: Math.max(0, current.monthlyBudgetMicros - remaining),
      })),
  });

  const onSaved = useCallback(
    (id: string, savedAt?: string) => {
      if (searchParams.get("c") !== id) {
        setSearchParams({ c: id }, { replace: true });
      }
      void markSaved(id, savedAt);
      void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY });
    },
    [markSaved, queryClient, searchParams, setSearchParams],
  );

  function newConversation() {
    startNew();
    setSearchParams({});
  }

  async function rename(id: string, title: string) {
    await renameChatConversation(id, title).catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY });
  }

  async function remove(id: string) {
    try {
      await deleteChatConversation(id);
    } catch {
      return;
    }
    void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY });
    if (active?.id === id) newConversation();
  }

  const status = statusQuery.data;

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          granted ? (
            <>
              <Button type="button" variant="outline" onClick={newConversation}>
                <MessageSquarePlus className="size-4" aria-hidden />
                {t("newConversation")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void showOverlay("chat")}
              >
                <Layers className="size-4" aria-hidden />
                {t("openOverlay")}
              </Button>
            </>
          ) : null
        }
      />

      {statusQuery.isPending ? (
        <LoadingState />
      ) : statusQuery.error || !status ? (
        <ErrorState
          error={statusQuery.error}
          onRetry={() => void statusQuery.refetch()}
        />
      ) : !granted ? (
        <ChatAccessPanel status={status} onStatus={setStatus} />
      ) : (
        <div className="flex h-[calc(100vh-12rem)] min-h-[26rem] overflow-hidden rounded-xl border border-nexus-accent/12 bg-nexus-card/60">
          <aside className="flex w-60 shrink-0 flex-col border-r border-nexus-accent/10 bg-nexus-night/40">
            <nav
              aria-label={t("conversations")}
              className="min-h-0 flex-1 overflow-y-auto p-2"
            >
              <ChatConversations
                conversations={listQuery.data ?? []}
                activeId={active?.id ?? ""}
                onOpen={(id) => setSearchParams({ c: id })}
                onRename={(id, title) => void rename(id, title)}
                onDelete={(id) => void remove(id)}
              />
            </nav>
            <div className="border-t border-nexus-accent/10 p-3">
              <ChatBudget status={status} />
            </div>
          </aside>
          <section className="flex min-w-0 flex-1 flex-col">
            {loadFailed ? (
              <p className="p-4 text-[13px] text-red-300">
                {t("errors.not_found")}
              </p>
            ) : active ? (
              <ChatView
                key={`${active.id}:${active.version}`}
                id={active.id}
                initialMessages={active.messages}
                status={status}
                onStatus={setStatus}
                onSaved={onSaved}
                onBusyChange={setBusy}
                voice={voice}
              />
            ) : (
              <LoadingState />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
