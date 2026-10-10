import { isToolUIPart, type DynamicToolUIPart } from "ai";
import { useTranslations } from "use-intl";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { toolLabel } from "@/lib/api/chat";
import { cn } from "@/lib/utils";
import type { ChatUIMessage } from "@/types/chat";

/** What an answer shows: text, tools, a confirmation. */
type Block =
  | { kind: "text"; key: number; text: string }
  | {
      kind: "tools";
      key: string;
      parts: DynamicToolUIPart[];
      closed: boolean;
    }
  | { kind: "approval"; key: string; part: DynamicToolUIPart };

/**
 * The parts of an answer, with the tools that follow each other grouped:
 * they show as chips side by side. A write confirmed or declined closes its
 * group, so that its summary sits right under it.
 */
function blocks(message: ChatUIMessage): Block[] {
  const result: Block[] = [];
  message.parts.forEach((part, index) => {
    if (part.type === "text") {
      if (part.text.trim()) {
        result.push({ kind: "text", key: index, text: part.text });
      }
      return;
    }
    if (!isToolUIPart(part)) return;
    const tool = part as DynamicToolUIPart;
    if (tool.state === "approval-requested") {
      result.push({ kind: "approval", key: tool.toolCallId, part: tool });
      return;
    }
    const previous = result[result.length - 1];
    if (previous?.kind === "tools" && !previous.closed && !tool.approval) {
      previous.parts.push(tool);
    } else {
      result.push({
        kind: "tools",
        key: tool.toolCallId,
        parts: [tool],
        closed: Boolean(tool.approval),
      });
    }
  });
  return result;
}

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
        <div className="chat-bubble max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-[13.5px] whitespace-pre-wrap text-white shadow-md shadow-black/20 select-text">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-[#dbe9fa] select-text">
      {blocks(message).map((block) => {
        switch (block.kind) {
          case "text":
            return <ChatMarkdown key={block.key} content={block.text} />;
          case "tools":
            return <ToolChips key={block.key} parts={block.parts} />;
          case "approval":
            return (
              <ApprovalCard
                key={block.key}
                part={block.part}
                onApproval={onApproval}
                disabled={disabled}
              />
            );
        }
      })}
    </div>
  );
}

/** A tool's name for the player, or its technical name when it is new. */
function useToolName() {
  const t = useTranslations("Chat.tool");
  return (toolName: string | undefined) => {
    const key = `names.${toolName ?? ""}` as "names.search";
    return t.has(key) ? t(key) : toolLabel(toolName ?? "");
  };
}

/** The confirmation a write waits for (an order, an addition, a contribution…). */
function ApprovalCard({
  part,
  onApproval,
  disabled,
}: {
  part: DynamicToolUIPart;
  onApproval: (approvalId: string, approved: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("Chat.tool");
  const toolName = useToolName();
  if (part.state !== "approval-requested") return null;

  return (
    <div className="chat-confirm space-y-2.5 rounded-2xl border border-[#8fd0ff]/45 p-3.5">
      <p className="text-[10.5px] font-bold tracking-[0.18em] text-[#8fd0ff] uppercase">
        {t("approvalTitle")}
      </p>
      <p className="text-[13px] whitespace-pre-wrap text-[#cfe2f7]">
        {part.approval.requestReason || toolName(part.toolName)}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onApproval(part.approval.id, false)}
        >
          {t("decline")}
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => onApproval(part.approval.id, true)}
        >
          {t("confirm")}
        </Button>
      </div>
    </div>
  );
}

/**
 * The tools called in a row, as chips: running, done, declined or failed.
 * The summary of a write confirmed or declined follows underneath.
 */
function ToolChips({ parts }: { parts: DynamicToolUIPart[] }) {
  const t = useTranslations("Chat.tool");
  const toolName = useToolName();

  const chips = parts.map((part) => {
    const name = toolName(part.toolName);
    let icon = <Loader2 className="size-3.5 animate-spin" aria-hidden />;
    let label = t("running", { name });
    let tone = "border-[#3aa0dc]/35 bg-[#3aa0dc]/12 text-[#8fd0ff]";
    let detail: string | undefined;
    switch (part.state) {
      case "approval-responded":
        label = part.approval.approved
          ? t("confirmed", { name })
          : t("declined", { name });
        break;
      case "output-available":
        icon = <Done />;
        label = part.approval
          ? t("confirmedDone", { name })
          : t("done", { name });
        detail = part.approval?.requestReason;
        break;
      case "output-denied":
        icon = <X className="size-3.5" aria-hidden />;
        tone = "border-nexus-accent/20 bg-transparent text-[#8fb1d6]";
        // Declined by the player, or refused by the server (a bad argument…).
        label = part.approval.isAutomatic
          ? t("refused", { name })
          : t("declined", { name });
        detail = part.approval.isAutomatic
          ? part.approval.reason
          : part.approval.requestReason;
        break;
      case "output-error":
        icon = <X className="size-3.5" aria-hidden />;
        tone = "border-red-300/35 bg-red-300/10 text-red-200";
        label = t("failed", { name });
        break;
    }
    return { id: part.toolCallId, icon, label, tone, detail };
  });

  return (
    <div className="space-y-1.5">
      <ul className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <li
            key={chip.id}
            className={cn(
              "inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-xs",
              chip.tone,
            )}
          >
            {chip.icon}
            <span className="truncate" title={chip.label}>
              {chip.label}
            </span>
          </li>
        ))}
      </ul>
      {chips.map(
        (chip) =>
          chip.detail && (
            <p
              key={chip.id}
              className="border-l-2 border-[#8fd0ff]/25 pl-3 text-xs whitespace-pre-wrap text-[#8fb1d6]"
            >
              {chip.detail}
            </p>
          ),
      )}
    </div>
  );
}

/** The filled tick of a tool that is done. */
function Done() {
  return (
    <span
      className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-[#4ade80] text-[#052e16]"
      aria-hidden
    >
      <Check className="size-2.5" strokeWidth={4} />
    </span>
  );
}
