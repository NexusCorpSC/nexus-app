import { useState } from "react";
import { Eye, Pencil } from "lucide-react";
import { useTranslations } from "use-intl";
import { Button, Card, Segmented } from "@/components/ui";
import { useNoteAutosave, type SaveStatus } from "@/components/note-editor";
import {
  RichNoteContent,
  RichNoteToolbar,
  useRichNoteEditor,
} from "@/components/notes/rich-note-editor";
import { cn } from "@/lib/utils";
import { NOTE_CONTENT_MAX_LENGTH, type Note } from "@/types/nexus";

type NoteMode = "edit" | "preview";

const STATUS_DOT: Record<SaveStatus | "dirty", string> = {
  idle: "bg-emerald-400",
  saved: "bg-emerald-400",
  saving: "bg-amber-300",
  dirty: "bg-amber-300",
  error: "bg-rose-400",
};

/**
 * The notes page's editor: the same Markdown, either raw in a textarea or as
 * rich text edited in place. Both modes write through one autosave, so
 * switching never loses an edit — unsaved text simply carries over.
 */
export function NoteWorkspace({
  note,
  signedIn,
  className,
  onSaved,
}: {
  note: Note;
  signedIn: boolean;
  className?: string;
  onSaved?: (note: Note) => void;
}) {
  const t = useTranslations("Notes");
  const { content, setContent, isDirty, status, error, statusLabel, saveNow } =
    useNoteAutosave({ note, signedIn, onSaved });

  // Reading is what the page is opened for most; the raw Markdown is a click
  // away for what the rich editor cannot do.
  const [mode, setMode] = useState<NoteMode>("preview");

  const { editor, readOnly } = useRichNoteEditor({
    markdown: content,
    onChange: setContent,
    active: mode === "preview",
  });

  const hint =
    mode === "edit"
      ? t("workspace.hintRaw")
      : readOnly
        ? t("workspace.hintReadOnly")
        : t("workspace.hintEditable");

  return (
    <Card className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-nexus-accent/12 px-3 py-2">
        <Segmented
          label={t("workspace.modeLabel")}
          value={mode}
          onChange={setMode}
          options={[
            {
              value: "edit",
              label: t("workspace.edit"),
              icon: <Pencil className="size-3.5" />,
            },
            {
              value: "preview",
              label: t("workspace.preview"),
              icon: <Eye className="size-3.5" />,
            },
          ]}
        />

        {mode === "preview" ? (
          <RichNoteToolbar editor={editor} disabled={readOnly} />
        ) : null}

        <span className="ml-auto pr-1 text-xs text-nexus-dim">{hint}</span>
      </div>

      {mode === "edit" ? (
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          maxLength={NOTE_CONTENT_MAX_LENGTH}
          placeholder={t("placeholder")}
          aria-label={t("title")}
          autoFocus
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-transparent px-6 py-5 font-mono text-[13.5px] leading-relaxed text-nexus-white outline-none placeholder:text-nexus-dim/80"
        />
      ) : null}

      {/*
       * Hidden rather than unmounted in raw mode: the editor keeps its view,
       * its undo history and its place in the text for when the user comes
       * back.
       */}
      <RichNoteContent
        editor={editor}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          mode !== "preview" && "hidden",
        )}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-nexus-accent/12 px-4 py-2.5 text-xs text-nexus-muted">
        <span className="flex min-w-0 items-center gap-2" aria-live="polite">
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              STATUS_DOT[isDirty ? "dirty" : status],
            )}
          />
          {error ? (
            <span className="truncate text-rose-300" title={error}>
              {statusLabel} — {error}
            </span>
          ) : (
            statusLabel
          )}
        </span>

        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-nexus-dim">
            {content.length} / {NOTE_CONTENT_MAX_LENGTH}
          </span>
          <Button
            type="button"
            size="sm"
            onClick={saveNow}
            disabled={!isDirty || status === "saving"}
          >
            {t("save")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
