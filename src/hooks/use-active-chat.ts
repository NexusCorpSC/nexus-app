import { useCallback, useRef, useState } from "react";
import { getChatConversation, newChatId } from "@/lib/api/chat";
import type { ChatUIMessage } from "@/types/chat";

export type ActiveChat = {
  id: string;
  messages: ChatUIMessage[];
  /** When the site last saved it, as it said; `null` until its first answer. */
  updatedAt: string | null;
  /** When it was opened here: a newer conversation elsewhere takes over. */
  since: string;
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
    setActive((current) => ({
      id: newChatId(),
      messages: [],
      updatedAt: null,
      since: new Date().toISOString(),
      version: (current?.version ?? 0) + 1,
    }));
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
          const shownAt = current.updatedAt ?? current.since;
          if (conversation.updatedAt <= shownAt) return current;
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
          since: new Date().toISOString(),
          version: (current?.version ?? 0) + 1,
        };
      });
      return true;
    },
    [],
  );

  /**
   * An answer was saved here: notes the site's date for it, without starting
   * the view over, so the next focus does not take our own answer for news.
   */
  const markSaved = useCallback(async (id: string) => {
    // The site saves as the stream ends; give it a moment to land.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const conversation = await getChatConversation(id).catch(() => null);
    if (!conversation) return;
    setActive((current) =>
      current?.id === id
        ? { ...current, updatedAt: conversation.updatedAt }
        : current,
    );
  }, []);

  return { active, startNew, load, markSaved, setBusy };
}
