import { useEffect, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";
import {
  getMyPositionSharing,
  isNotSharing,
  listPlayersInGame,
  reportMyPosition,
  setMyPositionSharing,
  sharingErrorMessage,
} from "@/lib/api/player-positions";
import { declarePlaying } from "@/lib/api/presence";
import { presenceChanged, usePresenceSync } from "@/hooks/use-presence";
import { bodyAt, positionOf, type Fix } from "@/lib/nps";
import type { NpsBody } from "@/types/nexus";
import {
  PLAYERS_REFRESH_MS,
  POSITION_STALE_MS,
  type MyPositionSharing,
  type PositionSharing,
} from "@/types/player-positions";

export const POSITION_SHARING_KEY = ["position-sharing"] as const;
export const PLAYERS_IN_GAME_KEY = ["players-in-game"] as const;

/**
 * Le suivi à l'écran donne un relevé chaque seconde : on n'en envoie qu'un
 * toutes les 5 s au plus, et seulement si l'on a bougé de 50 m, ou toutes les
 * 30 s pour dire qu'on est toujours là. Un /showlocation part toujours : le
 * joueur l'a demandé.
 */
const MIN_SEND_MS = 5_000;
const KEEPALIVE_MS = 30_000;
const MIN_MOVE_M = 50;

/**
 * Mon réglage de partage, le même que sur le site, et de quoi le changer.
 * Relu de temps en temps : il se change aussi depuis la Star Map.
 */
export function usePositionSharing() {
  const queryClient = useQueryClient();
  usePresenceSync(POSITION_SHARING_KEY);

  const query = useQuery({
    queryKey: POSITION_SHARING_KEY,
    queryFn: getMyPositionSharing,
    refetchInterval: 60_000,
  });

  const save = useMutation({
    mutationFn: (input: Partial<PositionSharing>) =>
      setMyPositionSharing(input),
    onSuccess: (next, input) => {
      queryClient.setQueryData(POSITION_SHARING_KEY, next);
      void queryClient.invalidateQueries({ queryKey: PLAYERS_IN_GAME_KEY });
      // Activer déclare en jeu : la fenêtre principale doit le montrer.
      if (input.enabled !== undefined) presenceChanged();
    },
  });

  // Partage actif mais session arrêtée : reprendre la session relance l'envoi.
  const resume = useMutation({
    mutationFn: () => declarePlaying(undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: POSITION_SHARING_KEY });
      presenceChanged();
    },
  });

  const unauthorized =
    query.error instanceof ApiError && query.error.isUnauthorized;

  return { query, sharing: query.data ?? null, unauthorized, save, resume };
}

/** Les joueurs en jeu que je vois, relus toutes les 10 s quand `enabled`. */
export function usePlayersInGame(enabled: boolean) {
  return useQuery({
    queryKey: PLAYERS_IN_GAME_KEY,
    queryFn: listPlayersInGame,
    enabled,
    refetchInterval: enabled ? PLAYERS_REFRESH_MS : false,
  });
}

type Sent = { at: number; body?: string; x: number; y: number; z: number };

function patch(
  queryClient: QueryClient,
  change: (current: MyPositionSharing) => MyPositionSharing,
) {
  queryClient.setQueryData<MyPositionSharing>(POSITION_SHARING_KEY, (current) =>
    current ? change(current) : current,
  );
}

/**
 * Envoie les relevés au site tant que le partage est actif et que je suis en
 * jeu : arrêter la session depuis la fenêtre principale arrête l'envoi, et le
 * site efface alors ma position.
 *
 * Renvoie la dernière erreur d'envoi, à afficher sur la carte.
 */
export function usePositionReporting(
  fix: Fix | null,
  bodies: NpsBody[],
  system: string | null,
  sharing: MyPositionSharing | null,
): string | null {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const last = useRef<Sent | null>(null);
  const sending = useRef(false);
  const active = Boolean(sharing?.sharing.enabled && sharing.playing);

  // Le partage repris repart d'un premier envoi, sans attendre 30 s.
  useEffect(() => {
    if (!active) last.current = null;
  }, [active]);

  useEffect(() => {
    if (!active || !fix || sending.current || bodies.length === 0) return;
    const now = Date.now();
    // Un relevé d'avant l'activation peut partir, pas un trop vieux.
    if (now - fix.at > POSITION_STALE_MS) return;
    // Comme un marqueur : dans le repère du corps sur une planète, sinon
    // dans celui du système, qu'il faut alors connaître.
    const position = positionOf(fix, bodies);
    const systemSlug = bodyAt(fix, bodies)?.systemSlug ?? system ?? undefined;
    if (!position.body && !systemSlug) return;

    const previous = last.current;
    if (previous && fix.source === "screen") {
      const elapsed = now - previous.at;
      if (elapsed < MIN_SEND_MS) return;
      const moved =
        previous.body === position.body
          ? Math.hypot(
              position.x - previous.x,
              position.y - previous.y,
              position.z - previous.z,
            )
          : Infinity;
      if (moved < MIN_MOVE_M && elapsed < KEEPALIVE_MS) return;
    }

    sending.current = true;
    last.current = { at: now, ...position };
    reportMyPosition({
      position,
      systemSlug,
      source: fix.source === "screen" ? "screen" : "showlocation",
    })
      .then((reported) => {
        setError(null);
        patch(queryClient, (current) => ({
          ...current,
          playing: true,
          position: reported,
        }));
      })
      .catch((failure: unknown) => {
        console.error("cannot share the position", failure);
        if (isNotSharing(failure)) {
          // Coupé sur le site entre-temps.
          void queryClient.invalidateQueries({
            queryKey: POSITION_SHARING_KEY,
          });
          return;
        }
        // Le prochain relevé réessaiera.
        last.current = previous;
        setError(sharingErrorMessage(failure));
      })
      .finally(() => {
        sending.current = false;
      });
  }, [active, fix, bodies, system, queryClient]);

  return active ? error : null;
}
