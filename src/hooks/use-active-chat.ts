import { useCallback, useRef, useState } from "react";
import { getChatConversation, newChatId } from "@/lib/api/chat";
import type { ChatUIMessage } from "@/types/chat";

export type ActiveChat = {
  id: string;
  messages: ChatUIMessage[];
  /** When the site last saved it, as it said; `null` until its first answer. */
  updatedAt: string | null;
  /**
   * The site's date of the latest conversation when this one was opened: a
   * conversation saved after it, elsewhere, takes over. Always the site's
   * clock, never this computer's, which can be off. `null` while unknown.
   */
  since: string | null;
  /** Bumped when the messages are replaced, to start the view over. */
  version: number;
};

/**
 * The conversation a window shows, kept in step with the site.
 *
 * The same conversation can go on in the main window, in the overlay and on
 * the site; the site holds it. A window that comes back into focus reads it
 * again and takes the newer copy — never while an answer is on its way, which
 * would cut it off (`busy`).
 */
export function useActiveChat() {
  const [active, setActive] = useState<ActiveChat | null>(null);
  const busy = useRef(false);

  const setBusy = useCallback((value: boolean) => {
    busy.current = value;
  }, []);

  const startNew = useCallback(() => {
    const id = newChatId();
    setActive((current) => ({
      id,
      messages: [],
      updatedAt: null,
      since: latestOf(current?.updatedAt, current?.since),
      version: (current?.version ?? 0) + 1,
    }));
    // What the site holds as its latest conversation now: only one saved
    // after it replaces this new one.
    void getChatConversation("latest")
      .then((latest) => {
        if (!latest) return;
        setActive((current) =>
          current?.id === id
            ? { ...current, since: latestOf(current.since, latest.updatedAt) }
            : current,
        );
      })
      .catch(() => {});
  }, []);

  /**
   * Reads `id` (or `latest`) from the site and shows it if it is newer than
   * what is on screen. `false` when there is no such conversation.
   * `opened`: the player picked it, so it is shown even over an answer on
   * its way (which goes on, and is saved, on the site).
   */
  const load = useCallback(
    async (
      id: string,
      options: { onlyIfNewer?: boolean; opened?: boolean } = {},
    ) => {
      if (busy.current && !options.opened) return true;
      const conversation = await getChatConversation(id);
      if (!conversation) return false;
      if (busy.current && !options.opened) return true;
      setActive((current) => {
        if (current && options.onlyIfNewer) {
          const shownAt = latestOf(current.updatedAt, current.since);
          // Not knowing what is on screen yet: keep it.
          if (!shownAt || conversation.updatedAt <= shownAt) return current;
        }
        if (
          current?.id === conversation.id &&
          current.updatedAt === conversation.updatedAt
        ) {
          return current;
        }
        return {
          id: conversation.id,
          messages: conversation.messages,
          updatedAt: conversation.updatedAt,
          since: conversation.updatedAt,
          version: (current?.version ?? 0) + 1,
        };
      });
      return true;
    },
    [],
  );

  /**
   * An answer was saved here: notes the site's date for it (`savedAt`, sent
   * with the answer), without starting the view over, so the next focus does
   * not take our own answer for news.
   */
  const markSaved = useCallback(async (id: string, savedAt?: string) => {
    // An older site does not send it: ask.
    const updatedAt =
      savedAt ??
      (await getChatConversation(id).catch(() => null))?.updatedAt ??
      null;
    if (!updatedAt) return;
    setActive((current) =>
      current?.id === id ? { ...current, updatedAt } : current,
    );
  }, []);

  return { active, startNew, load, markSaved, setBusy };
}

/** The later of two ISO dates of the site. */
function latestOf(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}
