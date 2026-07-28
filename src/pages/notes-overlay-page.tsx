import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NotebookPen, X } from "lucide-react";
import { useAuth } from "@/auth/auth-context";
import { NoteEditor } from "@/components/note-editor";
import { ErrorState, LoadingState } from "@/components/ui";
import { noteQueryKey, readNote } from "@/lib/notes";
import { useTransparentWindow } from "@/hooks/use-transparent-window";

/**
 * The scratch pad as a standalone always-on-top window, so notes stay readable
 * while the user is in game. Unlike the search palette this one survives losing
 * focus — it is dismissed by its shortcut or its close button.
 */
export default function NotesOverlayPage() {
  const { user, loading } = useAuth();
  const signedIn = Boolean(user);
  const queryClient = useQueryClient();

  useTransparentWindow();

  const queryKey = noteQueryKey(signedIn);

  const { data, isPending, error, refetch } = useQuery({
    queryKey,
    queryFn: () => readNote(signedIn),
    staleTime: 0,
    enabled: !loading,
  });

  // The window is hidden and shown again rather than recreated, so nothing
  // remounts: without this the overlay would keep showing whatever it read the
  // first time, ignoring edits made from the main window.
  useEffect(() => {
    const onFocus = () => void refetch();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetch]);

  function close() {
    void invoke("close_notes_overlay");
  }

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden rounded-xl border border-white/10 bg-[#061E30]/95 shadow-2xl backdrop-blur-xl"
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
        className="flex shrink-0 cursor-grab items-center gap-2 border-b border-white/10 px-3 py-2"
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
