import { useState, type ReactNode } from "react";
import { MapPin, Trash2 } from "lucide-react";
import type { ViewMode } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { Location } from "@/types/nexus";

/** What the inventory cards and rows need, personal and shared alike. */
export type InventoryDisplayItem = {
  id: string;
  name: string;
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

export function sortInventoryItems<T extends InventoryDisplayItem>(
  items: T[],
  sort: InventorySort,
) {
  const sorted = [...items];
  if (sort === "name") {
    sorted.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  } else if (sort === "quantity") {
    sorted.sort((a, b) => b.quantity - a.quantity);
  } else {
    sorted.sort(
      (a, b) =>
        (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0),
    );
  }
  return sorted;
}

export type LocationGroup<T> = {
  key: string;
  name: string;
  items: T[];
};

/** Groups items by location, keeping the order the items come in. */
export function groupByLocation<T extends InventoryDisplayItem>(
  items: T[],
): LocationGroup<T>[] {
  const groups = new Map<string, LocationGroup<T>>();
  for (const item of items) {
    const key = locationKey(item);
    let group = groups.get(key);
    if (!group) {
      group = { key, name: item.location?.name ?? "Lieu inconnu", items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === UNKNOWN_LOCATION) return 1;
    if (b.key === UNKNOWN_LOCATION) return -1;
    return a.name.localeCompare(b.name, "fr");
  });
}

/** The grid / list choice, remembered per page when storage allows it. */
export function useStoredViewMode(storageKey: string) {
  const [view, setView] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem(storageKey) === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });

  function changeView(next: ViewMode) {
    setView(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Storage unavailable: the choice lasts for this visit only.
    }
  }

  return [view, changeView] as const;
}

function formatShortDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatQuantity(item: InventoryDisplayItem) {
  return item.quantity.toLocaleString("fr-FR");
}

function QualityPill({ quality }: { quality: number }) {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-400/12 px-2 py-0.5 text-[11px] font-medium text-amber-300">
      Qualité {quality}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Grid                                                                */
/* ------------------------------------------------------------------ */

export function LocationGroupHeading({
  name,
  count,
}: {
  name: string;
  count: number;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <MapPin className="size-3.5 shrink-0 text-nexus-dim" />
      <h2 className="text-[13.5px] font-semibold text-nexus-white">{name}</h2>
      <span className="text-xs text-nexus-dim">{count}</span>
      <span className="h-px flex-1 bg-nexus-accent/12" />
    </div>
  );
}

export function InventoryGrid<T extends InventoryDisplayItem>({
  items,
  renderFooter,
}: {
  items: T[];
  renderFooter: (item: T) => ReactNode;
}) {
  return (
    <div className="space-y-6">
      {groupByLocation(items).map((group) => (
        <section key={group.key}>
          <LocationGroupHeading name={group.name} count={group.items.length} />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {group.items.map((item) => (
              <InventoryCard key={item.id} item={item}>
                {renderFooter(item)}
              </InventoryCard>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function InventoryCard({
  item,
  children,
}: {
  item: InventoryDisplayItem;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-nexus-accent/12 bg-nexus-card p-3.5 transition-colors hover:border-nexus-accent/35">
      <div className="flex items-start justify-between gap-3">
        <p className="line-clamp-2 min-w-0 text-sm font-semibold break-words text-nexus-white">
          {item.name}
        </p>
        <p className="shrink-0 text-right font-display text-xl leading-none font-bold text-nexus-accent">
          ×{formatQuantity(item)}
          {item.unit ? (
            <span className="ml-1 font-sans text-xs font-medium text-nexus-muted">
              {item.unit}
            </span>
          ) : null}
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {item.quality != null ? <QualityPill quality={item.quality} /> : null}
        <span className="text-xs text-nexus-dim">
          maj {formatShortDate(item.updatedAt)}
        </span>
      </div>

      {children ? (
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

export function InventoryList<T extends InventoryDisplayItem>({
  items,
  renderMeta,
  renderActions,
}: {
  items: T[];
  renderMeta?: (item: T) => ReactNode;
  renderActions?: (item: T) => ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-nexus-accent/12 bg-nexus-card">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-4 border-b border-nexus-accent/8 px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-nexus-accent/5"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-nexus-white">
              {item.name}
            </p>
            <p className="mt-0.5 truncate text-xs text-nexus-dim">
              {renderMeta ? <>{renderMeta(item)} · </> : null}
              {item.location?.name ?? "Lieu inconnu"}
              {item.quality != null ? (
                <>
                  {" · "}
                  <span className="text-amber-300">
                    qualité {item.quality}
                  </span>
                </>
              ) : null}
              {` · maj ${formatShortDate(item.updatedAt)}`}
            </p>
          </div>

          <p className="shrink-0 text-right font-display text-base font-bold text-nexus-accent">
            ×{formatQuantity(item)}
            {item.unit ? (
              <span className="ml-1 font-sans text-xs font-medium text-nexus-muted">
                {item.unit}
              </span>
            ) : null}
          </p>

          {renderActions ? (
            <div className="flex shrink-0 items-center gap-3">
              {renderActions(item)}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

export function OrgVisibleCheckbox({
  checked,
  disabled,
  onChange,
  compact = false,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  compact?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-1.5 text-xs text-nexus-muted hover:text-nexus-bright",
        disabled && "cursor-wait",
      )}
      title="Rendre visible aux membres de vos organisations"
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 rounded border-nexus-accent/30 bg-nexus-abyss accent-nexus-accent"
      />
      {compact ? "Org" : "Visible par l'org"}
    </label>
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
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-red-300/55 transition-colors",
        "hover:bg-red-500/15 hover:text-red-300",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}
