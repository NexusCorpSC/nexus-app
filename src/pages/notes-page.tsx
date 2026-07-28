import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/auth-context";
import { NoteEditor } from "@/components/note-editor";
import { ErrorState, LoadingState, PageHeader } from "@/components/ui";
import { noteQueryKey, readNote } from "@/lib/notes";
import {
  DEFAULT_SHORTCUTS,
  formatShortcut,
  getShortcuts,
  type Shortcuts,
} from "@/lib/settings";

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

  return (
    <div>
      <PageHeader
        title="Bloc-notes"
        description={
          signedIn
            ? "Vos notes en ligne, partagées avec le site Nexus Tools."
            : "Notes enregistrées sur cet ordinateur. Connectez-vous pour les retrouver sur le site et vos autres appareils."
        }
      />

      <p className="mb-4 text-xs text-nexus-accent/50">
        {formatShortcut(shortcuts.notes)} affiche ces notes en superposition,
        par-dessus le jeu.
      </p>

      {loading || isPending ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <NoteEditor
          key={queryKey.join(":")}
          initialNote={data}
          signedIn={signedIn}
          className="h-[32rem]"
          onSaved={(note) => queryClient.setQueryData(queryKey, note)}
        />
      )}
    </div>
  );
}
