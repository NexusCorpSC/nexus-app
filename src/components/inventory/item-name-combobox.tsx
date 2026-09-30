import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { listItems } from "@/lib/api/items";
import { useDebounced } from "@/hooks/use-debounced";
import { cn } from "@/lib/utils";
import { ITEM_KIND_LABELS, type ItemKind } from "@/types/nexus";

/** Case and accents aside, as a player types an object's name. */
function fold(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/** Below this, the catalogue matches too much to be worth asking. */
const MIN_REMOTE_QUERY = 2;
/** Beyond this, typing more narrows the list faster than scrolling it. */
const MAX_SUGGESTIONS = 50;

type Suggestion = { name: string; held: boolean; kind?: ItemKind };

/**
 * An object's name, typed freely, with the names already known offered as
 * the reader types: those they already hold first, then every object of the
 * game the API finds. A name matching none is kept as typed.
 *
 * Nothing is highlighted until an arrow key is pressed, so Enter keeps its
 * meaning for the form around — the next row, or submitting.
 *
 * The list is drawn over the page, not inside the field's parent: the bulk
 * add's table scrolls sideways, and would clip it.
 */
export function ItemNameCombobox({
  value,
  onChange,
  held = [],
  inputRef,
  placeholder,
  className,
  invalid,
  required,
  autoFocus,
  onPaste,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (name: string) => void;
  /** Names of what the reader already holds. */
  held?: string[];
  inputRef?: Ref<HTMLInputElement>;
  placeholder?: string;
  className?: string;
  invalid?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  onPaste?: (e: ClipboardEvent<HTMLInputElement>) => void;
  "aria-label"?: string;
}) {
  const listId = useId();
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const typed = value.trim();
  const query = useDebounced(typed, 200);

  const remoteQuery = useQuery({
    queryKey: ["item-names", query],
    queryFn: () => listItems({ query, limit: MAX_SUGGESTIONS }),
    enabled: open && query.length >= MIN_REMOTE_QUERY,
    staleTime: 10 * 60_000,
    placeholderData: (previous) => previous,
  });

  const suggestions = useMemo<Suggestion[]>(() => {
    const needle = fold(typed);
    if (!needle) return held.map((name) => ({ name, held: true }));

    const byName = new Map<string, Suggestion>();
    for (const name of held) {
      if (fold(name).includes(needle)) {
        byName.set(fold(name), { name, held: true });
      }
    }
    // The API also matches descriptions and makers: only names count here.
    const remote = query.length >= MIN_REMOTE_QUERY ? remoteQuery.data : null;
    for (const item of remote?.items ?? []) {
      const key = fold(item.name);
      if (!byName.has(key) && key.includes(needle)) {
        byName.set(key, { name: item.name, held: false, kind: item.kind });
      }
    }

    // A name starting with what is typed comes before one merely holding it.
    const starts = (s: Suggestion) => (fold(s.name).startsWith(needle) ? 0 : 1);
    return [...byName.values()]
      .sort(
        (a, b) =>
          Number(b.held) - Number(a.held) ||
          starts(a) - starts(b) ||
          a.name.localeCompare(b.name, "fr"),
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [typed, query, held, remoteQuery.data]);

  // Only the name exactly as typed left: nothing to offer.
  const visible =
    open &&
    suggestions.length > 0 &&
    !(suggestions.length === 1 && suggestions[0].name === typed);

  useEffect(() => {
    setHighlighted(-1);
  }, [typed]);

  // Keeps the list under the field while the page or the table scrolls.
  useLayoutEffect(() => {
    if (!visible) return;
    const place = () => {
      if (fieldRef.current) setRect(fieldRef.current.getBoundingClientRect());
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [visible]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${highlighted}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  function pick(name: string) {
    onChange(name);
    setOpen(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!visible) {
        setOpen(true);
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      setHighlighted((current) =>
        current < 0 && step < 0
          ? suggestions.length - 1
          : (current + step + suggestions.length) % suggestions.length,
      );
      return;
    }
    const option = visible ? suggestions[highlighted] : undefined;
    if (e.key === "Enter" && option && !e.ctrlKey && !e.metaKey) {
      // Picking a name is not moving to the next row, nor submitting.
      e.preventDefault();
      e.stopPropagation();
      pick(option.name);
      return;
    }
    if (e.key === "Tab" && option) {
      pick(option.name);
      return;
    }
    if (e.key === "Escape" && visible) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  const activeId =
    visible && highlighted >= 0 ? `${listId}-${highlighted}` : undefined;

  return (
    <>
      <input
        ref={(el) => {
          fieldRef.current = el;
          if (typeof inputRef === "function") inputRef(el);
          else if (inputRef) inputRef.current = el;
        }}
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        required={required}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onPaste={onPaste}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        className={className}
      />
      {visible && rect
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
              {suggestions.map((suggestion, index) => (
                <div
                  key={suggestion.name}
                  id={`${listId}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === highlighted}
                  // The field keeps the focus: a click must not blur it first.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => pick(suggestion.name)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-1.5",
                    index === highlighted && "bg-nexus-accent/12",
                  )}
                >
                  <Package
                    className={cn(
                      "size-3.5 shrink-0",
                      suggestion.held ? "text-nexus-accent" : "text-nexus-muted",
                    )}
                  />
                  <span className="truncate">{suggestion.name}</span>
                  <span className="ml-auto shrink-0 pl-2 text-xs text-nexus-dim">
                    {suggestion.held
                      ? "En stock"
                      : suggestion.kind
                        ? ITEM_KIND_LABELS[suggestion.kind]
                        : null}
                  </span>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
