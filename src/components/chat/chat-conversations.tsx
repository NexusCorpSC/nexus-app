import { useState } from "react";
import { useTranslations } from "use-intl";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CHAT_TITLE_MAX_LENGTH,
  type ChatConversationSummary,
} from "@/types/chat";

/** The player's conversations, newest first, each one renamable and deletable. */
export function ChatConversations({
  conversations,
  activeId,
  onOpen,
  onRename,
  onDelete,
}: {
  conversations: ChatConversationSummary[];
  activeId: string;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const t = useTranslations("Chat");

  if (conversations.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-nexus-dim">{t("noConversation")}</p>
    );
  }

  return (
    <ul className="space-y-0.5">
      {conversations.map((conversation) => (
        <ConversationRow
          key={conversation.id}
          conversation={conversation}
          current={conversation.id === activeId}
          onOpen={() => onOpen(conversation.id)}
          onRename={(title) => onRename(conversation.id, title)}
          onDelete={() => onDelete(conversation.id)}
        />
      ))}
    </ul>
  );
}

function ConversationRow({
  conversation,
  current,
  onOpen,
  onRename,
  onDelete,
}: {
  conversation: ChatConversationSummary;
  current: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const t = useTranslations("Chat");
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const [title, setTitle] = useState(conversation.title);

  if (mode === "rename") {
    return (
      <li>
        <form
          className="flex items-center gap-1 px-1 py-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim()) onRename(title.trim());
            setMode("view");
          }}
        >
          <input
            autoFocus
            value={title}
            maxLength={CHAT_TITLE_MAX_LENGTH}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setMode("view");
              }
            }}
            aria-label={t("rename")}
            className="min-w-0 flex-1 rounded border border-nexus-accent/30 bg-nexus-card px-2 py-1 text-[13px] text-nexus-white outline-none"
          />
          <button
            type="submit"
            className="rounded p-1 text-nexus-muted hover:text-nexus-white"
            aria-label={t("save")}
          >
            <Check className="size-3.5" aria-hidden />
          </button>
        </form>
      </li>
    );
  }

  return (
    <li
      className={cn(
        "group flex items-center gap-1 rounded-lg",
        current ? "bg-[#1e6aa8]/35" : "hover:bg-[#1e6aa8]/15",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={current ? "page" : undefined}
        className={cn(
          "min-w-0 flex-1 truncate px-2.5 py-1.5 text-left text-[13px]",
          current ? "text-nexus-white" : "text-nexus-accent/75",
        )}
        title={conversation.title}
      >
        {conversation.title}
      </button>
      {mode === "delete" ? (
        <span className="flex shrink-0 items-center gap-0.5 pr-1">
          <button
            type="button"
            onClick={onDelete}
            className="rounded px-1.5 py-0.5 text-xs text-red-300 hover:bg-red-500/10"
          >
            {t("delete")}
          </button>
          <button
            type="button"
            onClick={() => setMode("view")}
            className="rounded p-1 text-nexus-muted hover:text-nexus-white"
            aria-label={t("cancel")}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </span>
      ) : (
        <span className="flex shrink-0 items-center pr-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={() => {
              setTitle(conversation.title);
              setMode("rename");
            }}
            className="rounded p-1 text-nexus-muted hover:text-nexus-white"
            aria-label={t("rename")}
            title={t("rename")}
          >
            <Pencil className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setMode("delete")}
            className="rounded p-1 text-nexus-muted hover:text-red-300"
            aria-label={t("delete")}
            title={t("delete")}
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        </span>
      )}
    </li>
  );
}
