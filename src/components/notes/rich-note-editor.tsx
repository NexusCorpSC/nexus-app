import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  EditorContent,
  Extension,
  useEditor,
  useEditorState,
  type Editor,
} from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Markdown, type MarkdownManager } from "@tiptap/markdown";
import { StarterKit } from "@tiptap/starter-kit";
import { Bold, Heading2, Italic, Link2, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { NOTE_CONTENT_MAX_LENGTH } from "@/types/nexus";

/**
 * Marks the transactions that bring a revision into the editor, as opposed to
 * the user typing: they skip the length check and stay out of the undo stack.
 */
const SYNC_META = "nexusNoteSync";

/**
 * The Markdown of each document the editor has held. The length check and the
 * update handler both need the text of the same new document, and serializing a
 * 20 000-character note twice per keystroke is wasted work.
 */
const serializedDocs = new WeakMap<ProseMirrorNode, string>();

function serializeDoc(manager: MarkdownManager, doc: ProseMirrorNode): string {
  let markdown = serializedDocs.get(doc);
  if (markdown === undefined) {
    markdown = manager.serialize(doc.toJSON());
    serializedDocs.set(doc, markdown);
  }
  return markdown;
}

/**
 * The textarea caps the note with `maxLength`; this does the same for the rich
 * editor, on the Markdown it would save. An edit that would go over is dropped
 * — unless it shortens a note that is already over, which a revision written
 * elsewhere may be, so the user can still bring it back under.
 */
const NoteLengthLimit = Extension.create({
  name: "nexusNoteLengthLimit",

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey("nexusNoteLengthLimit"),
        filterTransaction(tr, state) {
          const manager = editor.markdown;
          if (!tr.docChanged || tr.getMeta(SYNC_META) || !manager) return true;

          const next = serializeDoc(manager, tr.doc).length;
          if (next <= NOTE_CONTENT_MAX_LENGTH) return true;

          return next < serializeDoc(manager, state.doc).length;
        },
      }),
    ];
  },
});

/**
 * Constructs the site renders but this editor has no node for: loading them
 * would drop them silently — a table vanishes, a checkbox turns into a bullet —
 * and the next save would write that loss back.
 */
export function hasUnsupportedMarkdown(
  manager: MarkdownManager | undefined,
  markdown: string,
): boolean {
  if (!manager) return false;

  let unsupported = false;
  const marked = manager.instance;
  marked.walkTokens(marked.lexer(markdown), (token) => {
    if (
      token.type === "table" ||
      token.type === "html" ||
      token.type === "image" ||
      (token.type === "list_item" && "task" in token && token.task)
    ) {
      unsupported = true;
    }
  });
  return unsupported;
}

/** Only web and mail links leave the app; anything else stays inert. */
const OPENABLE_URL = /^(https?:|mailto:)/i;

/**
 * A rich text editor over a Markdown string, for the notes page's preview mode.
 *
 * The Markdown stays the source of truth — it is what gets saved and what the
 * site renders — so the editor reports its content as Markdown on every edit
 * and takes back any new `markdown` that did not come from itself: a revision
 * streamed in, or text typed in the raw mode.
 */
export function useRichNoteEditor({
  markdown,
  onChange,
  active,
}: {
  markdown: string;
  onChange: (markdown: string) => void;
  /** Hidden, the editor does not follow `markdown`; it catches up when shown. */
  active: boolean;
}): { editor: Editor; readOnly: boolean } {
  // The last Markdown the editor and the caller agreed on. Echoes of the
  // editor's own edits come back through `markdown`; reloading them would
  // reset the cursor on every keystroke.
  const syncedRef = useRef(markdown);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Markdown has no underline; the site would show the raw markers.
        underline: false,
        link: {
          // A click places the cursor, as anywhere else in the text; the link
          // opens with Ctrl/Cmd + click instead (see `handleClick`).
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: { title: "Ctrl + clic pour ouvrir le lien" },
        },
      }),
      Markdown,
      NoteLengthLimit,
    ],
    content: markdown,
    contentType: "markdown",
    editorProps: {
      attributes: {
        class: "nexus-rich-note",
        "aria-label": "Bloc-notes",
        spellcheck: "false",
      },
      handleClick(_view, _pos, event) {
        if (!event.ctrlKey && !event.metaKey) return false;

        const anchor = (event.target as HTMLElement | null)?.closest("a");
        const href = anchor?.getAttribute("href");
        if (!href || !OPENABLE_URL.test(href)) return false;

        void openUrl(href);
        return true;
      },
    },
    onUpdate({ editor }) {
      const next = editor.markdown
        ? serializeDoc(editor.markdown, editor.state.doc)
        : editor.getMarkdown();
      syncedRef.current = next;
      onChangeRef.current(next);
    },
  });

  const readOnly = useMemo(
    () => hasUnsupportedMarkdown(editor.markdown, markdown),
    [editor, markdown],
  );

  useEffect(() => {
    editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!active || markdown === syncedRef.current) return;

    syncedRef.current = markdown;
    editor
      .chain()
      .setMeta(SYNC_META, true)
      .setMeta("addToHistory", false)
      .setContent(markdown, { contentType: "markdown", emitUpdate: false })
      .run();
  }, [editor, markdown, active]);

  return { editor, readOnly };
}

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      // Keeps the focus — and so the selection — in the text being formatted.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-md transition-colors",
        "focus-visible:outline-2 focus-visible:outline-nexus-accent",
        "disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "bg-nexus-accent/16 text-nexus-white"
          : "text-nexus-muted hover:bg-nexus-accent/8 hover:text-nexus-bright",
      )}
    >
      {children}
    </button>
  );
}

/** Web addresses typed without a scheme would otherwise be relative links. */
function normalizeUrl(value: string): string {
  const url = value.trim();
  if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return `https://${url}`;
}

/** Bold, italic, heading, list and link: the formatting a note needs. */
export function RichNoteToolbar({
  editor,
  disabled = false,
}: {
  editor: Editor;
  disabled?: boolean;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      heading: editor.isActive("heading", { level: 2 }),
      list: editor.isActive("bulletList"),
      link: editor.isActive("link"),
    }),
  });

  // The address being typed for a new link; null while no link is being made.
  // An inline field rather than `window.prompt`, which not every webview
  // implements.
  const [linkDraft, setLinkDraft] = useState<string | null>(null);

  function toggleLink() {
    if (state.link) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    setLinkDraft("");
  }

  function applyLink() {
    const href = normalizeUrl(linkDraft ?? "");
    setLinkDraft(null);

    const chain = editor.chain().focus();
    if (!href) {
      chain.run();
      return;
    }

    // Without a selection there is no text to carry the link: the address
    // becomes its own text.
    if (editor.state.selection.empty) {
      chain
        .insertContent({
          type: "text",
          text: href,
          marks: [{ type: "link", attrs: { href } }],
        })
        .run();
    } else {
      chain.extendMarkRange("link").setLink({ href }).run();
    }
  }

  return (
    <div className="flex items-center gap-0.5 border-l border-nexus-accent/12 pl-2">
      <ToolbarButton
        label="Gras"
        active={state.bold}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Italique"
        active={state.italic}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Titre"
        active={state.heading}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Liste"
        active={state.list}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label={state.link ? "Retirer le lien" : "Lien"}
        active={state.link || linkDraft !== null}
        disabled={disabled}
        onClick={toggleLink}
      >
        <Link2 className="size-4" />
      </ToolbarButton>

      {linkDraft !== null && !disabled ? (
        <input
          type="url"
          autoFocus
          value={linkDraft}
          onChange={(event) => setLinkDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              applyLink();
            } else if (event.key === "Escape") {
              // The page must not treat it as anything else, and the text
              // gets its focus back.
              event.preventDefault();
              event.stopPropagation();
              setLinkDraft(null);
              editor.commands.focus();
            }
          }}
          onBlur={() => setLinkDraft(null)}
          placeholder="https://… puis Entrée"
          aria-label="Adresse du lien"
          className="ml-1 h-7 w-56 rounded-md border border-nexus-accent/25 bg-nexus-abyss/60 px-2 text-[12.5px] text-nexus-white placeholder:text-nexus-dim/80 focus:border-nexus-accent/50 focus:outline-none"
        />
      ) : null}
    </div>
  );
}

/** The editable text itself, with a placeholder while the note is empty. */
export function RichNoteContent({
  editor,
  className,
}: {
  editor: Editor;
  className?: string;
}) {
  const empty = useEditorState({
    editor,
    selector: ({ editor }) => editor.isEmpty,
  });

  return (
    <div className={cn("relative", className)}>
      {empty ? (
        <p className="pointer-events-none absolute top-5 left-6 text-[15px] text-nexus-dim/80">
          Routes de minage, prix, plans de mission…
        </p>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
