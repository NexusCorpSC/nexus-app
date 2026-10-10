import { isToolUIPart, type DynamicToolUIPart } from "ai";
import { useTranslations } from "use-intl";
import {
  Check,
  CircleAlert,
  Loader2,
  ShieldQuestion,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { toolLabel } from "@/lib/api/chat";
import type { ChatUIMessage } from "@/types/chat";

/**
 * One message of the conversation: the player's text, or the assistant's
 * answer with the tools it called and the confirmations it waits for — as
 * the site shows them (`components/chat/chat-message.tsx` in nexus-tools).
 */
export function ChatMessage({
  message,
  onApproval,
  disabled,
}: {
  message: ChatUIMessage;
  onApproval: (approvalId: string, approved: boolean) => void;
  disabled?: boolean;
}) {
  if (message.role === "user") {
    const text = message.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-nexus-accent/18 px-3.5 py-2 text-[13.5px] whitespace-pre-wrap text-nexus-white select-text">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 text-nexus-bright select-text">
      {message.parts.map((part, index) => {
        if (part.type === "text") {
          return part.text.trim() ? (
            <ChatMarkdown key={index} content={part.text} />
          ) : null;
        }
        if (isToolUIPart(part)) {
          return (
            <ToolCard
              key={part.toolCallId}
              part={part as DynamicToolUIPart}
              onApproval={onApproval}
              disabled={disabled}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

function ToolCard({
  part,
  onApproval,
  disabled,
}: {
  part: DynamicToolUIPart;
  onApproval: (approvalId: string, approved: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("Chat.tool");
  const name = toolLabel(part.toolName ?? "");

  if (part.state === "approval-requested") {
    return (
      <div className="space-y-2.5 rounded-xl border border-amber-300/35 bg-amber-950/30 p-3">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-amber-200">
          <ShieldQuestion className="size-4" aria-hidden />
          {t("approvalTitle")}
        </p>
        <p className="text-[13px] whitespace-pre-wrap text-nexus-white">
          {part.approval.requestReason || name}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => onApproval(part.approval.id, true)}
          >
            {t("confirm")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => onApproval(part.approval.id, false)}
          >
            {t("decline")}
          </Button>
        </div>
      </div>
    );
  }

  let icon = <Loader2 className="size-3.5 animate-spin" aria-hidden />;
  let label = t("running", { name });
  let detail: string | undefined;
  switch (part.state) {
    case "approval-responded":
      label = part.approval.approved
        ? t("confirmed", { name })
        : t("declined", { name });
      break;
    case "output-available":
      icon = <Check className="size-3.5 text-emerald-300" aria-hidden />;
      label = part.approval
        ? t("confirmedDone", { name })
        : t("done", { name });
      detail = part.approval?.requestReason;
      break;
    case "output-denied":
      icon = <X className="size-3.5 text-amber-300" aria-hidden />;
      // Declined by the player, or turned down by the server (a bad argument…).
      label = part.approval.isAutomatic
        ? t("refused", { name })
        : t("declined", { name });
      detail = part.approval.isAutomatic
        ? part.approval.reason
        : part.approval.requestReason;
      break;
    case "output-error":
      icon = <CircleAlert className="size-3.5 text-red-300" aria-hidden />;
      label = t("failed", { name });
      break;
    case "input-streaming":
    case "input-available":
      icon = (
        <span className="flex items-center gap-1">
          <Wrench className="size-3.5" aria-hidden />
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        </span>
      );
      break;
  }

  return (
    <div className="rounded-lg border border-nexus-accent/12 bg-nexus-night/50 px-3 py-1.5 text-xs text-nexus-muted">
      <p className="flex items-center gap-2">
        {icon}
        <span>{label}</span>
      </p>
      {detail && (
        <p className="mt-1 pl-5.5 whitespace-pre-wrap text-nexus-dim">
          {detail}
        </p>
      )}
    </div>
  );
}
