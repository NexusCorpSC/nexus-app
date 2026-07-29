import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Search, Loader2 } from "lucide-react";
import { searchEverything } from "@/lib/api/search";
import { useDebounced } from "@/hooks/use-debounced";
import { useTransparentWindow } from "@/hooks/use-transparent-window";
import {
  DEFAULT_SHORTCUTS,
  formatShortcut,
  getShortcuts,
  type Shortcuts,
} from "@/lib/settings";
import {
  openSearchResult,
  opensInBrowser,
  SEARCH_TYPE_LABELS,
} from "@/lib/search";
import {
  objectivesToBulkLines,
  parseMissionText,
} from "@/lib/mission-objectives";
import { CargoCaptureImport } from "@/components/cargo/capture-import";
import { BlueprintQuickAdd } from "@/components/blueprint-add-button";
import { useAuth } from "@/auth/auth-context";
import { cn } from "@/lib/utils";
import type { ParsedBulkLine } from "@/lib/cargo";
import { MIN_SEARCH_QUERY_LENGTH, type SearchResult } from "@/types/nexus";

/** Event carrying OCR text from a region capture (see src-tauri/src/lib.rs). */
const SEARCH_EVENT = "overlay://search";

/**
 * A capture reads line by line, which the mission log needs but a search query
 * does not: a text input drops the newlines rather than honouring them, gluing
 * the last word of a line to the first of the next.
 */
function asQuery(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Quick-search palette shown over whatever the user is doing, opened by a
 * global shortcut. Its window is transparent and frameless, so this component
 * draws the whole surface.
 *
 * It searches everything the site searches — blueprints, missions, factions,
 * items on sale, shops, organizations, cargo ships, and the user's own
 * inventory when signed in — and hands each result to whichever of the two
 * clients has a screen for it (see `src/lib/search.ts`).
 */
export default function OverlayPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [shortcuts, setShortcuts] = useState<Shortcuts>(DEFAULT_SHORTCUTS);
  /**
   * A capture that read as a mission log: the palette becomes an import.
   *
   * `id` counts the captures, and keys the import below: a second capture
   * while the first is still on screen is a second import, not an update of
   * the first — which would otherwise never be added to the sheet.
   */
  const [cargo, setCargo] = useState<{
    id: number;
    lines: ParsedBulkLine[];
    ignored: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebounced(query, 200);

  const trimmedQuery = debouncedQuery.trim();
  // Below the minimum the API answers 400 rather than searching, so asking
  // would only turn a half-typed word into an error message.
  const searchable = trimmedQuery.length >= MIN_SEARCH_QUERY_LENGTH;

  const { data, isFetching, error } = useQuery({
    queryKey: ["overlay-search", trimmedQuery],
    queryFn: () => searchEverything(trimmedQuery),
    enabled: searchable,
  });

  const results = data?.results ?? [];

  useTransparentWindow();

  // The hints below must show what is actually bound, not the defaults.
  useEffect(() => {
    void getShortcuts().then(setShortcuts);
  }, []);

  // The window is shown by Rust, which cannot focus the input for us.
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    focus();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);

  // Text recognised from a screen capture lands straight in the search bar —
  // unless it reads as an in-game mission log, which is cargo, not a search.
  useEffect(() => {
    const pending = listen<string>(SEARCH_EVENT, (event) => {
      const mission = parseMissionText(event.payload);

      if (mission.objectives.length > 0) {
        setCargo((current) => ({
          id: (current?.id ?? 0) + 1,
          lines: objectivesToBulkLines(mission.objectives),
          ignored: mission.ignored.length,
        }));
        return;
      }

      setCargo(null);
      setQuery(asQuery(event.payload));
      setHighlighted(0);
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => {
      void pending.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    setHighlighted(0);
  }, [debouncedQuery]);

  function close() {
    void invoke("close_search_overlay");
  }

  function open(result: SearchResult) {
    void openSearchResult(result).catch((cause) => {
      console.error("cannot open the search result", cause);
    });

    // Closed either way: the main window comes to the front, and a palette
    // left behind it would only be in the way at the next shortcut.
    close();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted((current) => {
        const next = current + step;
        if (next < 0) return results.length - 1;
        if (next >= results.length) return 0;
        return next;
      });
      return;
    }

    if (event.key === "Enter" && results[highlighted]) {
      event.preventDefault();
      open(results[highlighted]);
    }
  }

  // A capture that read as a mission log has nothing to do with searching:
  // the palette hands it to the cargo sheet and says what became of it.
  if (cargo) {
    return (
      <div
        className="flex h-screen w-screen items-start justify-center p-3"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
      >
        <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-[#061E30]/95 shadow-2xl backdrop-blur-xl">
          <CargoCaptureImport
            key={cargo.id}
            lines={cargo.lines}
            ignored={cargo.ignored}
            onDone={() => {
              setCargo(null);
              close();
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-screen w-screen items-start justify-center p-3"
      onKeyDown={onKeyDown}
    >
      <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-[#061E30]/95 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-3 border-b border-white/10 px-4">
          <Search className="size-5 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher…"
            className="w-full bg-transparent py-4 text-lg text-slate-100 outline-none placeholder:text-slate-500"
            /* The palette owns keyboard navigation. */
            autoComplete="off"
            spellCheck={false}
          />
          {isFetching && (
            <Loader2 className="size-4 shrink-0 animate-spin text-slate-400" />
          )}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {error && (
            <p className="px-4 py-6 text-sm text-rose-300">
              Recherche indisponible — vérifiez l'URL de l'API dans Paramètres.
            </p>
          )}

          {!error && searchable && results.length === 0 && !isFetching && (
            <p className="px-4 py-6 text-sm text-slate-400">Aucun résultat.</p>
          )}

          {!error && !searchable && (
            <p className="px-4 py-6 text-sm text-slate-400">
              {trimmedQuery
                ? `Tapez au moins ${MIN_SEARCH_QUERY_LENGTH} caractères.`
                : null}
              {!trimmedQuery && (
                <>
                  Tapez pour rechercher, ou capturez une zone de l'écran avec
                  <kbd className="mx-1 rounded border border-white/15 px-1.5 py-0.5 text-xs">
                    {formatShortcut(shortcuts.capture)}
                  </kbd>
                  pour lire le texte à l'écran.
                </>
              )}
            </p>
          )}

          {results.map((result, index) => (
            /* The row is a button, so the quick add sits beside it rather than
               inside: nested buttons are not a thing, and opening the result
               is not what the add is for. */
            <div
              key={`${result.type}:${result.id}`}
              onMouseEnter={() => setHighlighted(index)}
              className={cn(
                "flex w-full items-center gap-1 pr-3 transition",
                index === highlighted ? "bg-white/10" : "hover:bg-white/5",
              )}
            >
              <button
                type="button"
                onClick={() => open(result)}
                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-100">
                    {result.title}
                  </p>
                  {result.subtitle && (
                    <p className="truncate text-xs text-slate-400">
                      {result.subtitle}
                    </p>
                  )}
                </div>

                {/* Says where it will open, since half the results have no
                    screen here and land in the browser. */}
                {opensInBrowser(result) && (
                  <ExternalLink className="size-3.5 shrink-0 text-slate-500" />
                )}

                <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-300">
                  {SEARCH_TYPE_LABELS[result.type]}
                </span>
              </button>

              {/* A result says nothing about possession, so the button is
                  offered on every blueprint: the add is idempotent and reports
                  back which of the two it did. */}
              {user && result.type === "blueprint" ? (
                <BlueprintQuickAdd blueprintId={result.id} tone="overlay" />
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 text-xs text-slate-500">
          <span>↑↓ naviguer · ⏎ ouvrir · Échap fermer</span>
          <span>{formatShortcut(shortcuts.search)}</span>
        </div>
      </div>
    </div>
  );
}
