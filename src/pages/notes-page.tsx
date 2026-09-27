import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/auth-context";
import { Layers } from "lucide-react";
import { NoteWorkspace } from "@/components/notes/note-workspace";
import {
  Button,
  ErrorState,
  Kbd,
  LoadingState,
  PageHeader,
} from "@/components/ui";
import { useNoteStream } from "@/hooks/use-note-stream";
import { noteQueryKey, readNote } from "@/lib/notes";
import {
  DEFAULT_SHORTCUTS,
  formatShortcut,
  getShortcuts,
  type Shortcuts,
} from "@/lib/settings";
import { showOverlay } from "@/lib/windows";

export default function NotesPage() {
  const { user, loading } = useAuth();
  const signedIn = Boolean(user);
  const queryClient = useQueryClient();

  const [shortcuts, setShortcuts] = useState<Shortcuts>(DEFAULT_SHORTCUTS);

  useEffect(() => {
    void getShortcuts().then(setShortcuts);
  }, []);

  const queryKey = noteQueryKey(signedIn);

  const { data, isPending, error, refetch } = useQuery({
    queryKey,
    queryFn: () => readNote(signedIn),
    // The overlay edits the same note; never serve a stale copy on open.
    staleTime: 0,
    // The session decides which note applies, so wait for it to settle.
    enabled: !loading,
  });

  // Written elsewhere — the overlay, the site — the note arrives on its own.
  useNoteStream(signedIn);

  return (
    <div>
      <PageHeader
        title="Bloc-notes"
        description={
          signedIn
            ? "Vos notes en ligne, partagées avec le site Nexus Tools."
            : "Notes enregistrées sur cet ordinateur. Connectez-vous pour les retrouver sur le site et vos autres appareils."
        }
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void showOverlay("notes").catch((error) =>
                  console.error("cannot open the notes overlay", error),
                )
              }
            >
              <Layers className="size-4" />
              Afficher par-dessus le jeu
            </Button>
            <Kbd>{formatShortcut(shortcuts.notes)}</Kbd>
          </>
        }
      />

      {loading || isPending ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <NoteWorkspace
          key={queryKey.join(":")}
          note={data}
          signedIn={signedIn}
          // The page's padding and header above, the rest of the window for
          // the note.
          className="h-[calc(100vh-10.5rem)] min-h-96"
          onSaved={(note) => queryClient.setQueryData(queryKey, note)}
        />
      )}
    </div>
  );
}
