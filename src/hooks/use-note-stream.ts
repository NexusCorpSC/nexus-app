import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { noteQueryKey } from "@/lib/notes";
import type { Note } from "@/types/nexus";

/** Emitted by Rust with every revision of the note the event stream delivers. */
const NOTE_CHANGED_EVENT = "note://changed";

/**
 * Keeps the account's note in the query cache as the stream delivers it.
 *
 * Every window that shows the note calls this; the editor adopts what lands in
 * the cache unless it is holding unsaved edits, which is what stops a revision
 * from another device from erasing what is being typed. Our own save comes
 * back this way too, identical to what the editor already set.
 *
 * Only the account's note: the local scratch pad is this machine's alone, and
 * nothing streams it.
 */
export function useNoteStream(signedIn: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!signedIn) return;

    let unlisten: UnlistenFn | null = null;
    let gone = false;

    void listen<Note>(NOTE_CHANGED_EVENT, (event) => {
      queryClient.setQueryData<Note>(noteQueryKey(true), event.payload);
    })
      .then((stop) => {
        if (gone) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        console.error("cannot follow the note stream", error);
      });

    return () => {
      gone = true;
      unlisten?.();
    };
  }, [signedIn, queryClient]);
}
