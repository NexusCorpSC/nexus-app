import { translator } from "@/i18n/translate";
import { ApiError, apiRequest } from "@/lib/api-client";
import type { Friend, FriendList, MyFriendCode } from "@/types/nexus";

/**
 * Friends: a mutual link made by a single-use code (see `lib/friends.ts` in
 * Nexus Tools). The list tells who is playing, with what they declared.
 */

export function listFriends() {
  return apiRequest<FriendList>("/api/me/friends");
}

/** The pending code, without creating one. */
export function getFriendCode() {
  return apiRequest<MyFriendCode>("/api/me/friends/code");
}

/** The pending code, created if there is none; the same one until it is used. */
export function createFriendCode() {
  return apiRequest<MyFriendCode>("/api/me/friends/code", { method: "POST" });
}

/** Becomes friends with the owner of `code`, which is used up. */
export function addFriend(code: string) {
  return apiRequest<Friend>("/api/me/friends", {
    method: "POST",
    body: { code },
  });
}

/** Ends the friendship, for both sides. */
export function removeFriend(userId: string) {
  return apiRequest<null>(`/api/me/friends/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

/** The refusals the friends API answers with a code of its own. */
const CODES = [
  "invalid_code",
  "not_found",
  "own_code",
  "already_friends",
  "too_many_attempts",
] as const;

type FriendErrorCode = (typeof CODES)[number];

function isFriendErrorCode(value: unknown): value is FriendErrorCode {
  return (CODES as readonly unknown[]).includes(value);
}

/** A refusal of the friends API, as a sentence. */
export function friendErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { error?: string } | undefined;
    return isFriendErrorCode(body?.error)
      ? translator("Api.friends")(body.error)
      : error.message;
  }
  return error instanceof Error
    ? error.message
    : translator("Common")("operationFailed");
}

/** A code as typed or pasted — lower case, dashed, spaced — as the API takes it. */
export function cleanFriendCode(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** "K7QD92PX" → "K7QD-92PX". */
export function formatFriendCode(code: string) {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
