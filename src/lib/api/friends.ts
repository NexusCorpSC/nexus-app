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

const MESSAGES: Record<string, string> = {
  invalid_code: "Un code ami fait 8 caractères, comme K7QD-92PX.",
  not_found:
    "Ce code n'existe pas ou a déjà été utilisé. Demandez-en un nouveau.",
  own_code: "C'est votre propre code : partagez-le plutôt à un ami.",
  already_friends: "Vous êtes déjà amis.",
  too_many_attempts: "Trop de codes erronés : réessayez dans quelques minutes.",
};

/** A refusal of the friends API, as a sentence. */
export function friendErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { error?: string } | undefined;
    return (body?.error && MESSAGES[body.error]) || error.message;
  }
  return error instanceof Error ? error.message : "L'opération a échoué.";
}

/** "K7QD92PX" → "K7QD-92PX". */
export function formatFriendCode(code: string) {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
