import * as notesApi from "@/lib/api/notes";
import { getLocalNote, setLocalNote } from "@/lib/settings";
import type { Note } from "@/types/nexus";

/**
 * The scratch pad, read and written wherever it belongs for the current
 * session: the Nexus Tools account when signed in, the local store otherwise.
 *
 * Both sides expose the same shape, so the editor never has to know which one
 * it is talking to.
 */

export function readNote(signedIn: boolean): Promise<Note> {
  return signedIn ? notesApi.getNote() : getLocalNote();
}

export function writeNote(signedIn: boolean, content: string): Promise<Note> {
  return signedIn ? notesApi.saveNote(content) : setLocalNote(content);
}

/** Query key, so signing in or out swaps notes instead of reusing the cache. */
export function noteQueryKey(signedIn: boolean) {
  return ["note", signedIn ? "remote" : "local"] as const;
}
