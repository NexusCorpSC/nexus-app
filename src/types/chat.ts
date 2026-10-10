import type { UIMessage } from "ai";

/**
 * Nexus Chat, as the site serves it (`types/chat.ts` in nexus-tools): the
 * player's access and monthly budget, and their conversations.
 *
 * Amounts are in microdollars (millionths of a US dollar), as integers.
 */

export type ChatAccessStatus = "none" | "requested" | "granted" | "revoked";

/** `GET /api/chat/status`. */
export interface ChatStatus {
  /** Whether the admin has the chat open on the site. */
  enabled: boolean;
  status: ChatAccessStatus;
  monthlyBudgetMicros: number;
  spentMicros: number;
  remainingMicros: number;
  /** ISO date the budget starts again: the 1st of next month, UTC. */
  resetsAt: string;
  model: string;
}

/** `GET /api/chat/conversations`. */
export interface ChatConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** What the server attaches to each answer. */
export interface ChatMessageMetadata {
  costMicros?: number;
  remainingMicros?: number;
  budgetExhausted?: boolean;
  /** When the site saved the conversation with this answer (its `updatedAt`). */
  savedAt?: string;
}

export type ChatUIMessage = UIMessage<ChatMessageMetadata>;

/** `GET /api/chat/conversations/:id`. */
export interface ChatConversation extends ChatConversationSummary {
  messages: ChatUIMessage[];
}

/** The errors `POST /api/chat` answers in JSON, before any stream. */
export type ChatErrorCode =
  | "unauthorized"
  | "disabled"
  | "no_access"
  | "budget_exhausted"
  | "invalid_request"
  | "not_found"
  | "busy"
  | "unavailable";

export const CHAT_MESSAGE_MAX_LENGTH = 8000;
export const CHAT_TITLE_MAX_LENGTH = 80;
