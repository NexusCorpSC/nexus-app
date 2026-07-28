import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2 } from "lucide-react";
import { searchBlueprints } from "@/lib/api/blueprints";
import { useDebounced } from "@/hooks/use-debounced";
import { cn } from "@/lib/utils";
import type { Blueprint } from "@/types/nexus";

/** Event carrying OCR text from a region capture (see src-tauri/src/lib.rs). */
const SEARCH_EVENT = "overlay://search";

/**
 * Quick-search palette shown over whatever the user is doing, opened by a
 * global shortcut. Its window is transparent and frameless, so this component
 * draws the whole surface.
 */
export default function OverlayPage() {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebounced(query, 200);

  const { data, isFetching, error } = useQuery({
    queryKey: ["overlay-search", debouncedQuery],
    queryFn: () => searchBlueprints(debouncedQuery),
    enabled: debouncedQuery.trim().length > 0,
  });

  const results = data ?? [];

  // The window is transparent; the global stylesheet's opaque background would
  // otherwise paint the whole rectangle.
  useEffect(() => {
    const { style } = document.documentElement;
    const previous = style.background;
    style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      style.background = previous;
    };
  }, []);

  // The window is shown by Rust, which cannot focus the input for us.
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    focus();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);

  // Text recognised from a screen capture lands straight in the search bar.
  useEffect(() => {
    const pending = listen<string>(SEARCH_EVENT, (event) => {
      setQuery(event.payload);
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

  function open(blueprint: Blueprint) {
    void invoke("show_blueprint", { slug: blueprint.slug });
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
            placeholder="Rechercher un blueprint…"
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

          {!error && debouncedQuery.trim() && results.length === 0 && !isFetching && (
            <p className="px-4 py-6 text-sm text-slate-400">Aucun blueprint trouvé.</p>
          )}

          {!error && !debouncedQuery.trim() && (
            <p className="px-4 py-6 text-sm text-slate-400">
              Tapez pour rechercher, ou capturez une zone de l'écran avec
              <kbd className="mx-1 rounded border border-white/15 px-1.5 py-0.5 text-xs">
                Ctrl+Maj+S
              </kbd>
              pour lire le texte à l'écran.
            </p>
          )}

          {results.map((blueprint, index) => (
            <button
              key={blueprint.id}
              type="button"
              onClick={() => open(blueprint)}
              onMouseEnter={() => setHighlighted(index)}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-3 text-left transition",
                index === highlighted ? "bg-white/10" : "hover:bg-white/5",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-100">
                  {blueprint.name}
                </p>
                <p className="truncate text-xs text-slate-400">
                  {blueprint.category}
                  {blueprint.subcategory ? ` · ${blueprint.subcategory}` : ""}
                </p>
              </div>
              {blueprint.owned && (
                <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                  possédé
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 text-xs text-slate-500">
          <span>↑↓ naviguer · ⏎ ouvrir · Échap fermer</span>
          <span>Ctrl+Maj+B</span>
        </div>
      </div>
    </div>
  );
}
