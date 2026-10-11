import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { translator } from "@/i18n/translate";
import { listRefiningJobs } from "@/lib/api/refining";
import { notify } from "@/lib/notifications";
import {
  isFinished,
  REFINING_KEY,
  totalQuantity,
} from "@/lib/refining";
import {
  getRefiningNotifications,
  getRefiningNotified,
  setRefiningNotified,
} from "@/lib/settings";
import { formatNumber } from "@/lib/utils";

/** Orders change when the reader edits them: a minute is plenty. */
const REFRESH_MS = 60 * 1000;

/** The clock the countdowns and the end of an order are read against. */
const TICK_MS = 30 * 1000;

/** No more toasts than this at once: a backlog is summed up instead. */
const MAX_TOASTS = 3;

/** The time now, ticking every thirty seconds. */
export function useNow(every = TICK_MS) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

/** The reader's refining orders, shared by the page, the menu and the watcher. */
export function useRefiningJobs(userId: string | null | undefined) {
  return useQuery({
    queryKey: [...REFINING_KEY, userId],
    queryFn: listRefiningJobs,
    enabled: Boolean(userId),
    refetchInterval: REFRESH_MS,
  });
}

/** How many of the reader's orders are ready to collect, for the menu. */
export function useReadyRefiningCount(userId: string | null | undefined) {
  const now = useNow();
  const jobs = useRefiningJobs(userId);
  return (jobs.data ?? []).filter((job) => isFinished(job, now)).length;
}

/**
 * Keeps the reader's refining orders fresh, and tells them when one is done:
 * a toast that opens the Refining page. Each order is told once, even across
 * restarts — the orders already told are kept per account and per instance.
 * The first read for an account only sets that list, so installing the app
 * does not tell of every order already finished.
 *
 * Rather than ticking, it wakes at the next end: the window holding it is
 * the whole app, which a clock would redraw for nothing.
 */
export function useRefiningWatcher(userId: string | null) {
  const jobs = useRefiningJobs(userId);
  const [wake, setWake] = useState(0);
  // One look at a time: two at once would tell of the same order twice.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const data = jobs.data;

  // Up again at the next end, a second after it.
  useEffect(() => {
    if (!data) return;
    const now = Date.now();
    const next = Math.min(
      ...data
        .map((job) => Date.parse(job.endTime))
        .filter((end) => end > now),
    );
    if (!Number.isFinite(next)) return;
    // setTimeout holds 32 bits: beyond 24 days, the next refresh comes first.
    const delay = Math.min(next - now + 1000, 2 ** 31 - 1);
    const timer = setTimeout(() => setWake((count) => count + 1), delay);
    return () => clearTimeout(timer);
  }, [data, wake]);

  useEffect(() => {
    if (!userId || !data) return;
    const done = data.filter((job) => isFinished(job, Date.now()));

    queue.current = queue.current.then(async () => {
      try {
        const told = await getRefiningNotified(userId);
        const ids = done.map((job) => job.id);
        // Only orders still there are kept: collected ones are gone for good.
        await setRefiningNotified(userId, ids);
        if (told === null || !(await getRefiningNotifications())) return;

        const fresh = done.filter((job) => !told.includes(job.id));
        const t = translator("Refining.notify");
        const shown = fresh.slice(0, MAX_TOASTS);
        for (const job of shown) {
          await notify({
            kind: "success",
            title: t("title"),
            body:
              job.lines.length > 0
                ? t("body", {
                    location: job.location,
                    total: formatNumber(totalQuantity(job.lines)),
                  })
                : t("bodyNoLines", { location: job.location }),
            route: "/refining",
          });
        }
        if (fresh.length > shown.length) {
          await notify({
            kind: "success",
            title: t("title"),
            body: t("backlog", { count: fresh.length - shown.length }),
            route: "/refining",
          });
        }
      } catch (error) {
        console.error("cannot tell of finished refining orders", error);
      }
    });
  }, [userId, data, wake]);
}

