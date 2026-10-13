import { translator } from "@/i18n/translate";
import { ApiError, apiRequest } from "@/lib/api-client";
import type {
  MyPositionSharing,
  PlayerInGame,
  PlayerPosition,
  PositionInput,
  PositionSharing,
} from "@/types/player-positions";

/**
 * Qui voit ma position : un seul réglage sur le compte, le même que le champ
 * « Ma position » de la Star Map du site.
 */
export function getMyPositionSharing() {
  return apiRequest<MyPositionSharing>("/api/me/position-sharing");
}

/** Activer me déclare en jeu ; couper efface ma position. */
export function setMyPositionSharing(input: Partial<PositionSharing>) {
  return apiRequest<MyPositionSharing>("/api/me/position-sharing", {
    method: "PUT",
    body: input,
  });
}

/** Envoie un relevé. Refusé (409 `notSharing`) si le partage est coupé. */
export function reportMyPosition(input: PositionInput) {
  return apiRequest<PlayerPosition>("/api/me/position", {
    method: "PUT",
    body: input,
  });
}

/** Les joueurs en jeu dont je vois la position, moi compris si je partage. */
export async function listPlayersInGame() {
  return (
    await apiRequest<{ players: PlayerInGame[] }>("/api/starmap/joueurs")
  ).players;
}

/** Le partage a été coupé ailleurs, sur le site ou un autre appareil. */
export function isNotSharing(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.body as { error?: string } | undefined)?.error === "notSharing"
  );
}

export function sharingErrorMessage(error: unknown): string {
  const t = translator("NpsOverlay.share.errors");
  if (error instanceof ApiError) {
    if (error.isUnauthorized) return t("unauthorized");
    if (isNotSharing(error)) return t("notSharing");
    return error.message;
  }
  return error instanceof Error
    ? error.message
    : translator("Common")("sendFailed");
}
