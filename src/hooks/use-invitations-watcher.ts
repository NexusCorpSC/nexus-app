import { useEffect } from "react";
import { translator } from "@/i18n/translate";
import { getInvitations } from "@/lib/api/shares";
import { notify } from "@/lib/notifications";
import {
  getInviteNotifications,
  getInvitesNotified,
  setInvitesNotified,
} from "@/lib/settings";
import type { Invitation } from "@/types/nexus";

/** An invitation is for a session to come: two minutes is soon enough. */
const CHECK_INTERVAL_MS = 2 * 60 * 1000;

/** No more toasts than this at once: a backlog is summed up instead. */
const MAX_TOASTS = 3;

/** The page of the app for what was shared: the event, or the place. */
export function invitationRoute(invitation: Invitation): string {
  return invitation.kind === "place"
    ? `/places/${encodeURIComponent(invitation.targetId)}`
    : invitation.href;
}

/**
 * Tells the player when someone shares an event or a private place with them:
 * a toast that opens it. Each invitation is told once, even across restarts —
 * those already told are kept per account and per instance. Only unseen ones
 * are told: one opened on the site already was.
 */
export function useInvitationsWatcher(userId: string | null) {
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let running = false;

    const look = async () => {
      if (running) return;
      running = true;
      try {
        const { invitations } = await getInvitations();
        if (cancelled) return;
        const unseen = invitations.filter((invitation) => !invitation.seen);
        const told = (await getInvitesNotified(userId)) ?? [];
        // Only those still unseen are kept: the list does not grow forever.
        const kept = told.filter((id) =>
          unseen.some((invitation) => invitation.id === id),
        );
        const fresh = unseen.filter((invitation) => !told.includes(invitation.id));
        if (fresh.length === 0 || !(await getInviteNotifications())) {
          await setInvitesNotified(userId, [
            ...kept,
            ...fresh.map((invitation) => invitation.id),
          ]);
          return;
        }

        const t = translator("Invitations.notify");
        const shown = fresh.slice(0, MAX_TOASTS);
        try {
          for (const invitation of shown) {
            await notify({
              kind: "info",
              title:
                invitation.kind === "event"
                  ? t("eventTitle", { name: invitation.invitedByName })
                  : t("placeTitle", { name: invitation.invitedByName }),
              body: invitation.title,
              route: invitationRoute(invitation),
            });
            kept.push(invitation.id);
          }
          if (fresh.length > shown.length) {
            await notify({
              kind: "info",
              title: t("backlogTitle"),
              body: t("backlog", { count: fresh.length - shown.length }),
            });
            kept.push(...fresh.slice(shown.length).map((one) => one.id));
          }
        } finally {
          await setInvitesNotified(userId, kept);
        }
      } catch (error) {
        console.error("cannot read invitations", error);
      } finally {
        running = false;
      }
    };

    void look();
    const timer = setInterval(() => void look(), CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [userId]);
}
