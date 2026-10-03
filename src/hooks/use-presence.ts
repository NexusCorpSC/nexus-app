import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelPlannedSession,
  declarePlaying,
  getMyPresence,
  listMyUpcomingEvents,
  planSession,
  stopPlaying,
} from "@/lib/api/presence";
import type { MyPresence } from "@/types/nexus";

const MY_PRESENCE_KEY = ["presence", "me"] as const;

/** The events the reader registered to; dropped by every registration. */
export const MY_EVENTS_KEY = ["events", "me"] as const;

/**
 * How often a running declaration is renewed while the app is open.
 *
 * Well under the four hours the server keeps one alive: the point is that
 * someone who leaves the app open while playing stays «en jeu», and someone
 * who quits it stops showing a few hours later rather than never.
 */
const RENEW_EVERY_MS = 20 * 60_000;

/**
 * The reader's own declaration, and the ways to change it: playing or not,
 * and the next session planned.
 */
export function useMyPresence(enabled: boolean) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: MY_PRESENCE_KEY,
    queryFn: getMyPresence,
    enabled,
    // Declared from the site too: read again now and then.
    refetchInterval: 5 * 60_000,
  });

  const settle = (presence: MyPresence) => {
    queryClient.setQueryData(MY_PRESENCE_KEY, presence);
    // Whoever looks at an organization should see the change at once.
    void queryClient.invalidateQueries({ queryKey: ["presence", "org"] });
  };

  // `undefined` starts a session on the planned activity: see `declarePlaying`.
  const declare = useMutation({
    mutationFn: (activity: string | null | undefined) =>
      declarePlaying(activity),
    onSuccess: settle,
  });

  const stop = useMutation({
    mutationFn: stopPlaying,
    onSuccess: settle,
  });

  const plan = useMutation({
    mutationFn: planSession,
    onSuccess: settle,
  });

  const cancelPlanned = useMutation({
    mutationFn: cancelPlannedSession,
    onSuccess: settle,
  });

  // «Hors jeu» is both at once: no session running, none planned. One after
  // the other, the last answer being the whole presence as it now stands.
  const goOff = useMutation({
    mutationFn: async (current: MyPresence) => {
      let next = current;
      if (current.playing) next = await stopPlaying();
      if (next.planned) next = await cancelPlannedSession();
      return next;
    },
    onSuccess: settle,
  });

  return {
    presence: query.data ?? null,
    declare,
    stop,
    plan,
    cancelPlanned,
    goOff,
  };
}

/** The upcoming events the reader registered to: planned sessions to pick. */
export function useMyUpcomingEvents(enabled: boolean) {
  return useQuery({
    queryKey: MY_EVENTS_KEY,
    queryFn: listMyUpcomingEvents,
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Keeps a running declaration alive for as long as the main window lives.
 *
 * Renewed with the activity already declared, so a change made on the site
 * in the meantime is not undone by an older copy: the declaration is read
 * again right before each renewal.
 */
export function usePresenceRenewal(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    // Signing out clears the cache and turns this off; an answer still on its
    // way must not put the old account's presence back in. One renewal at a
    // time, too: a slow network must not stack them up.
    let cancelled = false;
    let running = false;

    const renew = async () => {
      if (running) return;
      running = true;
      try {
        const current = await getMyPresence();
        if (cancelled) return;
        const next = current.playing
          ? await declarePlaying(current.activity)
          : current;
        if (!cancelled) queryClient.setQueryData(MY_PRESENCE_KEY, next);
      } catch (error) {
        console.error("cannot renew the presence", error);
      } finally {
        running = false;
      }
    };

    const timer = setInterval(() => void renew(), RENEW_EVERY_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, queryClient]);
}
