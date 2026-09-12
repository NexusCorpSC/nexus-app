import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NotebookPen, X } from "lucide-react";
import { useAuth } from "@/auth/auth-context";
import { NoteEditor } from "@/components/note-editor";
import { ErrorState, LoadingState } from "@/components/ui";
import { noteQueryKey, readNote } from "@/lib/notes";
import { useFeedStatus } from "@/hooks/use-feed-status";
import { useNoteStream } from "@/hooks/use-note-stream";
import { useTransparentWindow } from "@/hooks/use-transparent-window";
import { useOverlayMode } from "@/hooks/use-overlay-opacity";
import { useOverlayLocked } from "@/hooks/use-overlay-lock";
import { OverlayOpacityButton } from "@/components/overlay-opacity-button";
import { OverlayLockButton } from "@/components/overlay-lock-button";
import { overlaySkin } from "@/lib/overlay-opacity";
import { cn } from "@/lib/utils";

/**
 * The scratch pad as a standalone always-on-top window, so notes stay readable
 * while the user is in game. Unlike the search palette this one survives losing
 * focus — it is dismissed by its shortcut or its close button.
 */
export default function NotesOverlayPage() {
  const { user, loading } = useAuth();
  const signedIn = Boolean(user);
  const queryClient = useQueryClient();
  const feed = useFeedStatus();

  useTransparentWindow();

  // Its own mode, flipped by the header button — and by the global shortcut,
  // which takes all three overlays to the same one.
  const mode = useOverlayMode("notes");

  // Locked, the window is a picture the clicks go through — all but the one on
  // the lock itself, which Rust keeps live.
  const locked = useOverlayLocked("notes");

  const queryKey = noteQueryKey(signedIn);

  const { data, isPending, error, refetch } = useQuery({
    queryKey,
    queryFn: () => readNote(signedIn),
    staleTime: 0,
    enabled: !loading,
  });

  // Written elsewhere — the main window, the site — the note arrives on its
  // own, over the stream Rust holds.
  useNoteStream(signedIn);

  // The window is hidden and shown again rather than recreated, so nothing
  // remounts. While the stream is up, every revision has already arrived; when
  // it is not — lost, or a server without one — the overlay coming back into
  // focus is the moment to make sure it shows the latest, as it always did.
  useEffect(() => {
    if (feed === "connected") return;

    const onFocus = () => void refetch();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [feed, refetch]);

  function close() {
    void invoke("close_notes_overlay");
  }

  return (
    <div
      className={cn(
        "flex h-screen w-screen flex-col overflow-hidden",
        overlaySkin(mode),
      )}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
    >
      {/* The window has no decorations, so the header doubles as its title bar. */}
      <div
        data-tauri-drag-region
        className={cn(
          "flex shrink-0 cursor-grab items-center gap-2 px-3 py-2",
          // The rule separates the header from the body of a panel; with no
          // panel it is just a line drawn across the game.
          mode === "opaque" ? "border-b border-white/10" : null,
        )}
      >
        <NotebookPen className="pointer-events-none size-4 text-slate-400" />
        <p className="pointer-events-none flex-1 truncate text-sm font-medium text-slate-200">
          Bloc-notes
        </p>
        {!signedIn && !loading && (
          <span className="pointer-events-none rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">
            local
          </span>
        )}
        <OverlayOpacityButton label="notes" mode={mode} />
        <OverlayLockButton label="notes" locked={locked} />

        <button
          type="button"
          onClick={close}
          title="Fermer"
          className="rounded p-1 text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
        >
          <span className="sr-only">Fermer</span>
          <X className="size-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-3">
        {loading || isPending ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : (
          <NoteEditor
            key={queryKey.join(":")}
            note={data}
            signedIn={signedIn}
            autoFocus
            className="flex-1"
            onSaved={(note) => queryClient.setQueryData(queryKey, note)}
          />
        )}
      </div>
    </div>
  );
}
