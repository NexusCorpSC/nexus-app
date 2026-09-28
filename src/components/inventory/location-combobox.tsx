import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus } from "lucide-react";
import { createLocation, listLocations } from "@/lib/api/inventory";
import { useDebounced } from "@/hooks/use-debounced";
import { cn } from "@/lib/utils";
import type { Location } from "@/types/nexus";

/** Case and accents aside, as a player types a place's name. */
function fold(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/** The API matches `query` as a regular expression: the text is taken as is. */
function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Beyond this, typing more narrows the list faster than scrolling it. */
const MAX_SUGGESTIONS = 50;

type Option =
  | { kind: "location"; location: Location }
  | { kind: "create"; name: string };

/**
 * A place picked by typing part of its name. The API caps its list, so the
 * text typed is sent to it rather than filtered out of a first page: every
 * place of the catalogue can be found. `preferred` — the places the reader
 * already stores things at — come first. A name matching none can be created.
 *
 * The list is drawn over the page, not inside the field's parent: the bulk
 * add's table scrolls sideways, and would clip it.
 */
export function LocationCombobox({
  value,
  onChange,
  preferred = [],
  placeholder,
  className,
  invalid,
  "aria-label": ariaLabel,
}: {
  value: Location | null;
  /** `null` when the field is emptied: back to no place, or the default one. */
  onChange: (location: Location | null) => void;
  preferred?: Location[];
  placeholder: string;
  className?: string;
  invalid?: boolean;
  "aria-label"?: string;
}) {
  const queryClient = useQueryClient();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [text, setText] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // What is shown follows the value picked, until the reader types again.
  useEffect(() => {
    if (!open) setText(value?.name ?? "");
  }, [value, open]);

  // The text typed, once it is not the name already picked.
  const typed = text.trim() && text !== value?.name ? text.trim() : "";
  const query = useDebounced(typed, 200);

  const remoteQuery = useQuery({
    queryKey: ["locations", query],
    queryFn: () => listLocations(query ? escapeRegExp(query) : undefined),
    enabled: open,
    staleTime: 10 * 60_000,
    placeholderData: (previous) => previous,
  });

  const options = useMemo<Option[]>(() => {
    const needle = fold(typed);
    const matches = (location: Location) =>
      !needle ||
      fold(location.name).includes(needle) ||
      fold(location.system ?? "").includes(needle);

    const byId = new Map<string, Location>();
    for (const location of preferred) {
      if (matches(location)) byId.set(location.id, location);
    }
    for (const location of remoteQuery.data ?? []) {
      if (!byId.has(location.id) && matches(location)) {
        byId.set(location.id, location);
      }
    }

    const found: Option[] = [...byId.values()]
      .slice(0, MAX_SUGGESTIONS)
      .map((location) => ({ kind: "location", location }));
    const exact = [...byId.values()].some(
      (location) => fold(location.name) === needle,
    );
    return typed && !exact
      ? [...found, { kind: "create", name: typed }]
      : found;
  }, [typed, preferred, remoteQuery.data]);

  useEffect(() => {
    setHighlighted(0);
  }, [typed]);

  // Keeps the list under the field while the page or the table scrolls.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (inputRef.current) setRect(inputRef.current.getBoundingClientRect());
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${highlighted}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const createMutation = useMutation({
    mutationFn: (name: string) => createLocation({ name }),
    onSuccess: async (location) => {
      await queryClient.invalidateQueries({ queryKey: ["locations"] });
      pick(location);
    },
  });

  function pick(location: Location) {
    onChange(location);
    setText(location.name);
    setOpen(false);
  }

  function choose(option: Option | undefined) {
    if (!option) return;
    if (option.kind === "location") pick(option.location);
    else if (!createMutation.isPending) createMutation.mutate(option.name);
  }

  function close() {
    setOpen(false);
    // An emptied field lets go of the place; any other text left unpicked
    // gives way to the place that was there.
    if (!text.trim()) {
      if (value) onChange(null);
    } else {
      setText(value?.name ?? "");
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      setHighlighted((current) =>
        options.length === 0
          ? 0
          : (current + step + options.length) % options.length,
      );
      return;
    }
    if (e.key === "Enter" && open && !e.ctrlKey && !e.metaKey) {
      // Picking a place is not moving to the next row.
      e.preventDefault();
      e.stopPropagation();
      choose(options[highlighted]);
      return;
    }
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setText(value?.name ?? "");
      setOpen(false);
      return;
    }
    // Typing part of a name and moving on takes the place highlighted.
    const option = options[highlighted];
    if (e.key === "Tab" && open && typed && option?.kind === "location") {
      pick(option.location);
    }
  }

  const activeId =
    open && options[highlighted] ? `${listId}-${highlighted}` : undefined;

  return (
    <>
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        spellCheck={false}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={(e) => {
          e.target.select();
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onBlur={close}
        onKeyDown={handleKeyDown}
        className={className}
      />
      {open && rect
        ? createPortal(
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              style={{
                position: "fixed",
                left: rect.left,
                top: rect.bottom + 4,
                minWidth: Math.max(rect.width, 256),
              }}
              className="z-50 max-h-72 overflow-auto rounded-lg border border-nexus-accent/25 bg-nexus-card py-1 text-[13.5px] text-nexus-white shadow-xl shadow-black/40"
            >
              {options.map((option, index) => (
                <div
                  key={
                    option.kind === "location" ? option.location.id : "create"
                  }
                  id={`${listId}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === highlighted}
                  // The field keeps the focus: a click must not blur it first.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => choose(option)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-1.5",
                    index === highlighted && "bg-nexus-accent/12",
                    option.kind === "create" &&
                      "border-t border-nexus-accent/15 text-nexus-accent",
                  )}
                >
                  {option.kind === "location" ? (
                    <>
                      <MapPin className="size-3.5 shrink-0 text-nexus-muted" />
                      <span className="truncate">{option.location.name}</span>
                      {option.location.system ? (
                        <span className="ml-auto shrink-0 pl-2 text-xs text-nexus-dim">
                          {option.location.system}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Plus className="size-3.5 shrink-0" />
                      <span className="truncate">
                        {createMutation.isPending
                          ? "Création…"
                          : `Créer « ${option.name} »`}
                      </span>
                    </>
                  )}
                </div>
              ))}
              {options.length === 0 ? (
                <p className="px-3 py-1.5 text-nexus-muted">
                  {remoteQuery.isFetching ? "Recherche…" : "Aucun lieu"}
                </p>
              ) : null}
              {createMutation.error ? (
                <p className="px-3 py-1.5 text-xs text-red-300">
                  {createMutation.error instanceof Error
                    ? createMutation.error.message
                    : "Création impossible."}
                </p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
