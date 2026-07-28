import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { writeNote } from "@/lib/notes";
import { cn } from "@/lib/utils";
import { NOTE_CONTENT_MAX_LENGTH, type Note } from "@/types/nexus";

/** Delay before edits are persisted on their own. */
const AUTOSAVE_DELAY_MS = 1200;

type SaveStatus = "idle" | "saving" | "saved" | "error";

type NoteEditorProps = {
  /**
   * The stored revision. Not just an initial value: the overlay rereads the
   * note every time it regains focus, and the editor follows what comes back.
   */
  note: Note;
  /** Where the note lives: the account when signed in, the local store else. */
  signedIn: boolean;
  autoFocus?: boolean;
  className?: string;
  textareaClassName?: string;
  /** Called with every saved revision, so the surrounding query stays fresh. */
  onSaved?: (note: Note) => void;
};

function formatUpdatedAt(iso: string | null): string | null {
  if (!iso) return null;

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  return `Enregistré ${date.toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  })}`;
}

/**
 * Free-form scratch pad with autosave.
 *
 * Saves overlap — the timer, the button and the flush on unmount can all be in
 * flight at once — and the API may answer out of order, so only the most recent
 * request is allowed to move the UI.
 */
export function NoteEditor({
  note,
  signedIn,
  autoFocus = false,
  className,
  textareaClassName,
  onSaved,
}: NoteEditorProps) {
  const [saved, setSaved] = useState(note);
  const [content, setContent] = useState(note.content);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const isDirty = content !== saved.content;

  // A reread brought a revision the editor has not seen — typically the main
  // window edited the note while the overlay was hidden. Adopt it, but never
  // over edits that are unsaved or still being written: those would vanish
  // under the user without a trace.
  useEffect(() => {
    if (isDirty || status === "saving") return;
    if (note.content === saved.content && note.updatedAt === saved.updatedAt) {
      return;
    }

    setSaved(note);
    setContent(note.content);
  }, [note, saved, isDirty, status]);

  const lastRequestRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  const save = useCallback(
    async (value: string) => {
      const requestId = ++lastRequestRef.current;
      const isLatest = () => requestId === lastRequestRef.current;

      setStatus("saving");

      try {
        const written = await writeNote(signedIn, value);

        // A late answer from an overtaken save must not reach the surrounding
        // query either, or it would put back the content the editor has
        // already moved past.
        if (!isLatest()) return;

        // Reported even once unmounted: closing the overlay flushes the last
        // edit, and the main window has to hear about that revision.
        onSavedRef.current?.(written);

        if (!isMountedRef.current) return;

        setSaved(written);
        setStatus("saved");
        setError(null);
      } catch (cause) {
        if (!isLatest() || !isMountedRef.current) return;

        setStatus("error");
        setError(
          cause instanceof Error
            ? cause.message
            : "Enregistrement impossible pour le moment.",
        );
      }
    },
    [signedIn],
  );

  // The timer and the unmount handler both need the values as of when they
  // fire, not as of when they were installed.
  const contentRef = useRef(content);
  const isDirtyRef = useRef(isDirty);
  useEffect(() => {
    contentRef.current = content;
    isDirtyRef.current = isDirty;
  }, [content, isDirty]);

  useEffect(() => {
    if (!isDirty) return;

    const timeout = setTimeout(() => {
      void save(contentRef.current);
    }, AUTOSAVE_DELAY_MS);

    return () => clearTimeout(timeout);
  }, [content, isDirty, save]);

  // Closing the overlay unmounts the editor: anything typed in the last second
  // would be lost without this.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    return () => {
      if (isDirtyRef.current) {
        void saveRef.current(contentRef.current);
      }
    };
  }, []);

  const statusLabel = isDirty
    ? "Modifications non enregistrées"
    : status === "saving"
      ? "Enregistrement…"
      : status === "error"
        ? "Échec de l'enregistrement"
        : formatUpdatedAt(saved.updatedAt);

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        maxLength={NOTE_CONTENT_MAX_LENGTH}
        placeholder="Routes de minage, prix, plans de mission…"
        aria-label="Bloc-notes"
        autoFocus={autoFocus}
        spellCheck={false}
        className={cn(
          "min-h-0 flex-1 resize-none rounded-lg border border-nexus-accent/20 bg-nexus-deep/40 p-3 font-mono text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-nexus-accent/50",
          textareaClassName,
        )}
      />

      {error && <p className="text-xs text-rose-300">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span aria-live="polite">{statusLabel}</span>

        <div className="flex items-center gap-3">
          <span>
            {content.length} / {NOTE_CONTENT_MAX_LENGTH}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void save(content)}
            disabled={!isDirty || status === "saving"}
          >
            Enregistrer
          </Button>
        </div>
      </div>
    </div>
  );
}
