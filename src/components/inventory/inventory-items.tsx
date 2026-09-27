import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { MapPin, Minus, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Location } from "@/types/nexus";

/** What the inventory cards need, personal and shared alike. */
export type InventoryDisplayItem = {
  id: string;
  name: string;
  description?: string;
  quality?: number;
  quantity: number;
  unit?: string;
  updatedAt: string;
  location: Location | null;
};

export type InventorySort = "updated" | "name" | "quantity";

export const INVENTORY_SORT_OPTIONS: { value: InventorySort; label: string }[] =
  [
    { value: "updated", label: "Mise à jour récente" },
    { value: "name", label: "Nom" },
    { value: "quantity", label: "Quantité" },
  ];

/** The key of the items stored nowhere known. */
export const UNKNOWN_LOCATION = "__none__";

export function locationKey(item: InventoryDisplayItem) {
  return item.location?.id ?? UNKNOWN_LOCATION;
}

/* ------------------------------------------------------------------ */
/* Grouping                                                            */
/* ------------------------------------------------------------------ */

/**
 * The same thing held at the same place, in the same unit: one card. Each
 * quality stays its own lot inside it — Sadaryx at 688, 510 and 256 is one
 * card of three lots, not three cards that look alike. The same grouping as
 * the web inventory.
 */
export type ItemGroup<T> = {
  key: string;
  name: string;
  unit?: string;
  /** Best quality first. */
  lots: T[];
  total: number;
  /** The latest update of any lot, as a timestamp. */
  updatedAt: number;
};

export type LocationSection<T> = {
  key: string;
  name: string;
  groups: ItemGroup<T>[];
  /** Sum of what is counted in SCU there, when anything is. */
  scu: number;
};

function roundQty(value: number) {
  return Math.round(value * 1000) / 1000;
}

function timestamp(value?: string) {
  return (value && Date.parse(value)) || 0;
}

function compareGroups<T>(sort: InventorySort) {
  return (a: ItemGroup<T>, b: ItemGroup<T>) => {
    if (sort === "name") return a.name.localeCompare(b.name, "fr");
    if (sort === "quantity") return b.total - a.total;
    return b.updatedAt - a.updatedAt;
  };
}

/** Places by name, a missing place last; resources in each by `sort`. */
export function groupInventory<T extends InventoryDisplayItem>(
  items: T[],
  sort: InventorySort = "updated",
): LocationSection<T>[] {
  const sections = new Map<string, LocationSection<T>>();

  for (const item of items) {
    const key = locationKey(item);
    let section = sections.get(key);
    if (!section) {
      section = {
        key,
        name: item.location?.name ?? "Lieu inconnu",
        groups: [],
        scu: 0,
      };
      sections.set(key, section);
    }
    if (item.unit?.trim().toLowerCase() === "scu") section.scu += item.quantity;

    const groupKey = `${item.name.trim().toLowerCase()}|${(item.unit ?? "").trim().toLowerCase()}`;
    let group = section.groups.find((g) => g.key === groupKey);
    if (!group) {
      group = {
        key: groupKey,
        name: item.name,
        unit: item.unit,
        lots: [],
        total: 0,
        updatedAt: 0,
      };
      section.groups.push(group);
    }
    group.lots.push(item);
    group.total = roundQty(group.total + item.quantity);
    group.updatedAt = Math.max(group.updatedAt, timestamp(item.updatedAt));
  }

  for (const section of sections.values()) {
    section.scu = roundQty(section.scu);
    for (const group of section.groups) {
      group.lots.sort((a, b) => (b.quality ?? -1) - (a.quality ?? -1));
    }
    section.groups.sort(compareGroups(sort));
  }

  return [...sections.values()].sort((a, b) => {
    if (a.key === UNKNOWN_LOCATION) return 1;
    if (b.key === UNKNOWN_LOCATION) return -1;
    return a.name.localeCompare(b.name, "fr");
  });
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

function formatShortDate(value: number) {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatQuantity(value: number) {
  return value.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
}

/** Out of 1000: gold from 700, blue from 500, grey below. */
function qualityTier(quality: number) {
  if (quality >= 700) {
    return { pill: "bg-amber-400/12 text-amber-300", bar: "bg-amber-300" };
  }
  if (quality >= 500) {
    return { pill: "bg-nexus-accent/12 text-nexus-accent", bar: "bg-nexus-accent" };
  }
  return { pill: "bg-nexus-muted/15 text-[#A9BFD0]", bar: "bg-[#A9BFD0]" };
}

function QualityBadge({ quality }: { quality: number }) {
  const tier = qualityTier(quality);
  return (
    <span
      className="flex items-center gap-2"
      title={`Qualité ${quality} / 1000`}
    >
      <span
        className={cn(
          "rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums",
          tier.pill,
        )}
      >
        Q {quality}
      </span>
      <span
        aria-hidden
        className="h-1 w-12 overflow-hidden rounded-full bg-nexus-accent/12"
      >
        <span
          className={cn("block h-full rounded-full", tier.bar)}
          style={{ width: `${Math.min(100, Math.max(0, quality / 10))}%` }}
        />
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Grid                                                                */
/* ------------------------------------------------------------------ */

export function LocationGroupHeading({
  name,
  count,
  scu,
}: {
  name: string;
  count: number;
  scu?: number;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <MapPin className="size-3.5 shrink-0 text-nexus-dim" />
      <h2 className="text-[13.5px] font-semibold text-nexus-white">{name}</h2>
      <span className="font-mono text-xs text-nexus-dim">
        {count} objet{count > 1 ? "s" : ""}
        {scu ? ` · ${formatQuantity(scu)} SCU` : ""}
      </span>
      <span className="h-px flex-1 bg-nexus-accent/12" />
    </div>
  );
}

export function InventoryGrid<T extends InventoryDisplayItem>({
  sections,
  renderLotMeta,
  renderLotActions,
  renderFooter,
}: {
  sections: LocationSection<T>[];
  /** Beside the quality of each lot: whose it is, for instance. */
  renderLotMeta?: (lot: T) => ReactNode;
  /** At the end of each lot's row. */
  renderLotActions?: (lot: T) => ReactNode;
  /** Under the lots; `active` is the lot picked, the first by default. */
  renderFooter?: (group: ItemGroup<T>, active: T) => ReactNode;
}) {
  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <section key={section.key}>
          <LocationGroupHeading
            name={section.name}
            count={section.groups.length}
            scu={section.scu}
          />
          <div className="grid grid-cols-2 items-start gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {section.groups.map((group) => (
              <InventoryGroupCard
                key={group.key + group.lots.map((lot) => lot.id).join()}
                group={group}
                renderLotMeta={renderLotMeta}
                renderLotActions={renderLotActions}
                renderFooter={renderFooter}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function InventoryGroupCard<T extends InventoryDisplayItem>({
  group,
  renderLotMeta,
  renderLotActions,
  renderFooter,
}: {
  group: ItemGroup<T>;
  renderLotMeta?: (lot: T) => ReactNode;
  renderLotActions?: (lot: T) => ReactNode;
  renderFooter?: (group: ItemGroup<T>, active: T) => ReactNode;
}) {
  const [activeId, setActiveId] = useState(group.lots[0].id);

  const multi = group.lots.length > 1;
  // Lots can only be picked when the footer has something to act on.
  const selectable = multi && Boolean(renderFooter);
  const active = group.lots.find((lot) => lot.id === activeId) ?? group.lots[0];
  const footer = renderFooter?.(group, active);

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-nexus-accent/12 bg-nexus-card p-3.5 transition-colors hover:border-nexus-accent/35">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-semibold break-words text-nexus-white">
            {group.name}
          </h3>
          <p className="mt-1 text-xs text-nexus-dim">
            {multi ? `${group.lots.length} lots · ` : null}
            maj {formatShortDate(group.updatedAt)}
          </p>
        </div>
        <p className="shrink-0 text-right leading-none whitespace-nowrap">
          <span className="font-display text-xl font-bold text-nexus-accent tabular-nums">
            ×{formatQuantity(group.total)}
          </span>
          {group.unit ? (
            <span className="ml-1 text-xs font-medium text-nexus-muted">
              {group.unit}
            </span>
          ) : null}
        </p>
      </header>

      {!multi && active.description ? (
        <p className="line-clamp-2 text-xs text-[#A9BFD0]">
          {active.description}
        </p>
      ) : null}

      <ul className="space-y-0.5">
        {group.lots.map((lot) => {
          const detail = (
            <>
              {lot.quality != null ? (
                <QualityBadge quality={lot.quality} />
              ) : (
                <span className="text-xs text-nexus-dim">Sans qualité</span>
              )}
              <span className="flex min-w-0 flex-1 items-center">
                {renderLotMeta?.(lot)}
              </span>
              {multi ? (
                <span className="font-mono text-[13px] font-semibold text-nexus-bright tabular-nums">
                  ×{formatQuantity(lot.quantity)}
                </span>
              ) : null}
            </>
          );

          return (
            <li
              key={lot.id}
              className={cn(
                "-mx-1.5 flex min-h-8 items-center gap-1 rounded-lg px-1.5",
                selectable && lot.id === active.id && "bg-nexus-accent/8",
              )}
            >
              {selectable ? (
                <button
                  type="button"
                  onClick={() => setActiveId(lot.id)}
                  aria-pressed={lot.id === active.id}
                  title="Choisir ce lot pour les actions de la carte"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left"
                >
                  {detail}
                </button>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-2 py-1">
                  {detail}
                </div>
              )}
              {renderLotActions?.(lot)}
            </li>
          );
        })}
      </ul>

      {footer ? (
        <footer className="mt-auto flex items-center gap-0.5 border-t border-nexus-accent/10 pt-2">
          {footer}
        </footer>
      ) : null}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

const ICON_BUTTON = cn(
  "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-nexus-muted transition-colors",
  "hover:bg-nexus-panel hover:text-nexus-soft",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nexus-accent",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

/** The whole card shared or not: mixed when only some lots are. */
export function OrgVisibleCheckbox({
  checked,
  indeterminate = false,
  disabled,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex flex-1 cursor-pointer items-center gap-2 text-[13px] text-nexus-bright",
        disabled && "cursor-wait",
      )}
      title="Rendre visible aux membres de vos organisations"
    >
      <input
        type="checkbox"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3.5 rounded border-nexus-accent/30 bg-nexus-abyss accent-nexus-accent"
      />
      Visible par l'org
    </label>
  );
}

/** « Qualité ≥ » in a toolbar: lots below it are left out. */
export function QualityFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex h-9.5 items-center gap-2 rounded-lg border border-nexus-accent/15 bg-nexus-card pr-1.5 pl-3 text-[13px] text-nexus-muted focus-within:border-nexus-accent/50">
      Qualité ≥
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        placeholder="0"
        onChange={(event) => onChange(event.target.value)}
        className="h-7 w-16 rounded-md border border-nexus-accent/15 bg-nexus-abyss px-2 font-mono text-[13px] text-nexus-white focus:outline-none"
      />
      {value ? (
        <button
          type="button"
          aria-label="Effacer le filtre de qualité"
          onClick={() => onChange("")}
          className="text-nexus-dim hover:text-nexus-soft"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </label>
  );
}

/** − or +: asks how much, then adds or takes it from the lot. */
export function AdjustQuantityButton({
  mode,
  disabled,
  onSubmit,
}: {
  mode: "add" | "remove";
  disabled?: boolean;
  onSubmit: (amount: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const label = mode === "add" ? "Ajouter" : "Retirer";
  const Icon = mode === "add" ? Plus : Minus;

  function close() {
    setOpen(false);
    setValue("");
    setError(null);
  }

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const amount = Number(value.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Quantité invalide");
      return;
    }
    onSubmit(amount);
    close();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        className={ICON_BUTTON}
      >
        <Icon className="size-3.5" />
      </button>
      {open ? (
        <form
          onSubmit={handleSubmit}
          className="absolute top-full right-0 z-20 mt-1 w-48 space-y-2 rounded-lg border border-nexus-accent/25 bg-nexus-deep p-3 shadow-xl shadow-black/40"
        >
          <p className="text-xs font-medium text-nexus-bright">{label}</p>
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            value={value}
            placeholder="Quantité"
            onChange={(event) => setValue(event.target.value)}
            className="h-8 w-full rounded-md border border-nexus-accent/20 bg-nexus-abyss px-2 font-mono text-[13px] text-nexus-white focus:border-nexus-accent/50 focus:outline-none"
          />
          {error ? <p className="text-xs text-red-300">{error}</p> : null}
          <button
            type="submit"
            className="h-7 w-full rounded-md bg-nexus-accent text-xs font-semibold text-nexus-abyss hover:bg-nexus-bright"
          >
            Valider
          </button>
        </form>
      ) : null}
    </div>
  );
}

export function DeleteIconButton({
  itemName,
  disabled,
  onClick,
}: {
  itemName: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label="Supprimer"
      title={`Supprimer ${itemName}`}
      disabled={disabled}
      onClick={onClick}
      className={cn(ICON_BUTTON, "hover:bg-red-500/15 hover:text-red-300")}
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}
