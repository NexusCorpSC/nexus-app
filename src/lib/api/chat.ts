import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { apiRequest } from "@/lib/api-client";
import { getApiBaseUrl, getSessionCookie } from "@/lib/settings";
import type {
  ChatConversation,
  ChatConversationSummary,
  ChatErrorCode,
  ChatStatus,
} from "@/types/chat";

export const CHAT_STATUS_KEY = ["chat", "status"] as const;
export const CHAT_CONVERSATIONS_KEY = ["chat", "conversations"] as const;

export function getChatStatus() {
  return apiRequest<ChatStatus>("/api/chat/status");
}

export function requestChatAccess() {
  return apiRequest<ChatStatus>("/api/chat/access", { method: "POST" });
}

export function listChatConversations() {
  return apiRequest<ChatConversationSummary[]>("/api/chat/conversations");
}

/** A conversation; `latest` is the most recent one, `null` when there is none. */
export function getChatConversation(id: string) {
  return apiRequest<ChatConversation | null>(
    `/api/chat/conversations/${encodeURIComponent(id)}`,
  );
}

export function renameChatConversation(id: string, title: string) {
  return apiRequest<{ id: string; title: string }>(
    `/api/chat/conversations/${encodeURIComponent(id)}`,
    { method: "PATCH", body: { title } },
  );
}

export function deleteChatConversation(id: string) {
  return apiRequest<void>(`/api/chat/conversations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/**
 * "Stop": the site stops the answer on its way after its current step. Cutting
 * the stream here is not enough, the site carries the answer through.
 */
export function requestChatStop() {
  return apiRequest<void>("/api/chat/stop", { method: "POST" });
}

/**
 * The `fetch` the chat transport streams its answers through: the HTTP plugin,
 * on the site the settings point at, with the persisted session — as every
 * other request of the app (`api-client.ts`), but handing back the `Response`
 * itself so the stream can be read as it arrives.
 */
export const chatFetch: typeof fetch = async (input, init) => {
  const base = await getApiBaseUrl();
  const path =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.pathname
        : input.url;
  const headers = new Headers(init?.headers);
  const cookie = await getSessionCookie();
  if (cookie) headers.set("Cookie", cookie);
  return tauriFetch(new URL(path, `${base}/`).toString(), {
    ...init,
    headers,
  });
};

/** A new conversation id (`CHAT_ID_PATTERN` on the site). */
export function newChatId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

const KNOWN_ERRORS: ChatErrorCode[] = [
  "unauthorized",
  "disabled",
  "no_access",
  "budget_exhausted",
  "invalid_request",
  "not_found",
  "busy",
  "unavailable",
];

/**
 * The code of a chat error: the JSON body `POST /api/chat` answers before any
 * stream, else `generic` (network, or an error in the middle of an answer).
 */
export function chatErrorCode(
  error: Error | undefined,
): ChatErrorCode | "generic" {
  if (!error) return "generic";
  try {
    const code = (JSON.parse(error.message) as { error?: unknown })?.error;
    if (KNOWN_ERRORS.includes(code as ChatErrorCode)) {
      return code as ChatErrorCode;
    }
  } catch {
    // Not JSON: an error from the stream or the network.
  }
  return "generic";
}

/** A readable MCP tool name: `search_items` → `search items`. */
export function toolLabel(name: string): string {
  return name.replace(/_/g, " ");
}
