import { Plus, X } from "lucide-react";
import { useTranslations } from "use-intl";
import { REFINED_MATERIALS } from "@/lib/refinery-work-order";
import { cn } from "@/lib/utils";
import type { RefiningLine } from "@/types/nexus";

/** A line being typed: the numbers stay text until they are checked. */
export type LineDraft = {
  key: number;
  name: string;
  quality: string;
  /** In cSCU. */
  quantity: string;
  /** When collecting: the line goes into the inventory. */
  take?: boolean;
};

type Checked =
  | { ok: true; line: RefiningLine }
  | { ok: false; field: "name" | "quality" | "quantity" };

let nextKey = 0;

export function toDraft(
  line: { name?: string; quality?: number; quantity?: number },
  take = true,
): LineDraft {
  return {
    key: nextKey++,
    name: line.name ?? "",
    quality: line.quality?.toString() ?? "",
    quantity: line.quantity?.toString() ?? "",
    take,
  };
}

/** A row left empty: neither counted nor flagged. */
export function isBlank(row: LineDraft) {
  return !row.name.trim() && !row.quality.trim() && !row.quantity.trim();
}

/** A line checked as the site checks it (`checkLines`). */
export function checkDraft(row: LineDraft): Checked {
  const name = row.name.trim();
  if (!name) return { ok: false, field: "name" };

  let quality: number | undefined;
  const rawQuality = row.quality.trim();
  if (rawQuality) {
    if (!/^\d+$/.test(rawQuality)) return { ok: false, field: "quality" };
    quality = parseInt(rawQuality, 10);
    if (quality > 1000) return { ok: false, field: "quality" };
  }

  const rawQuantity = row.quantity.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(rawQuantity)) return { ok: false, field: "quantity" };
  const quantity = Number(rawQuantity);
  if (quantity <= 0) return { ok: false, field: "quantity" };

  return { ok: true, line: { name, quality, quantity } };
}

/**
 * The materials of an order: name (known refined materials suggested),
 * quality out of 1000, quantity in cSCU. When collecting, a box per line
 * picks what goes into the inventory, and a column says what it becomes there.
 */
export function LinesTable({
  rows,
  onChange,
  selectable = false,
  outcome,
}: {
  rows: LineDraft[];
  onChange: (rows: LineDraft[]) => void;
  selectable?: boolean;
  outcome?: (row: LineDraft) => React.ReactNode;
}) {
  const t = useTranslations("Refining");
  const update = (key: number, patch: Partial<LineDraft>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const allTaken = rows.length > 0 && rows.every((row) => row.take);

  const cell =
    "h-9 w-full bg-transparent px-2.5 text-[13px] text-nexus-white placeholder:text-nexus-dim/70 focus:bg-nexus-panel focus:outline-none";

  return (
    <div className="overflow-x-auto rounded-lg border border-nexus-accent/15 bg-nexus-card">
      <table className="w-full min-w-[24rem] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-nexus-accent/15 bg-nexus-panel/60 text-left font-display text-[10.5px] font-semibold tracking-[0.12em] text-nexus-muted uppercase">
            {selectable ? (
              <th scope="col" className="w-8 px-2.5">
                <input
                  type="checkbox"
                  checked={allTaken}
                  onChange={(event) =>
                    onChange(
                      rows.map((row) => ({ ...row, take: event.target.checked })),
                    )
                  }
                  aria-label={t("collectTakeAll")}
                  className="accent-nexus-accent"
                />
              </th>
            ) : null}
            <th scope="col" className="px-2.5 py-2">
              {t("material")}
            </th>
            <th scope="col" className="w-20 px-2.5 text-right">
              {t("quality")}
            </th>
            <th scope="col" className="w-24 px-2.5 text-right">
              cSCU
            </th>
            {outcome ? (
              <th scope="col" className="px-2.5">
                {t("collectOutcome")}
              </th>
            ) : null}
            <th scope="col" className="w-8">
              <span className="sr-only">{t("removeLine")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const result = checkDraft(row);
            const field = result.ok || isBlank(row) ? undefined : result.field;
            const inactive = selectable && !row.take;
            return (
              <tr
                key={row.key}
                className={cn(
                  "border-b border-nexus-accent/8 [&>td+td]:border-l [&>td+td]:border-nexus-accent/8",
                  field && !inactive && "bg-red-400/5",
                  inactive && "opacity-55",
                )}
              >
                {selectable ? (
                  <td className="px-2.5">
                    <input
                      type="checkbox"
                      checked={row.take ?? false}
                      onChange={(event) =>
                        update(row.key, { take: event.target.checked })
                      }
                      aria-label={t("collectTake", { name: row.name })}
                      className="accent-nexus-accent"
                    />
                  </td>
                ) : null}
                <td>
                  <input
                    value={row.name}
                    list="refined-materials"
                    onChange={(event) =>
                      update(row.key, { name: event.target.value })
                    }
                    placeholder="Taranite"
                    aria-label={t("material")}
                    aria-invalid={field === "name" || undefined}
                    className={cell}
                  />
                </td>
                <td>
                  <input
                    inputMode="numeric"
                    value={row.quality}
                    onChange={(event) =>
                      update(row.key, { quality: event.target.value })
                    }
                    placeholder="—"
                    aria-label={t("quality")}
                    aria-invalid={field === "quality" || undefined}
                    className={cn(
                      cell,
                      "text-right font-mono",
                      field === "quality" && "bg-red-400/10 text-red-300",
                    )}
                  />
                </td>
                <td>
                  <input
                    inputMode="decimal"
                    value={row.quantity}
                    onChange={(event) =>
                      update(row.key, { quantity: event.target.value })
                    }
                    placeholder="?"
                    aria-label={t("quantityCscu")}
                    aria-invalid={field === "quantity" || undefined}
                    className={cn(
                      cell,
                      "text-right font-mono",
                      field === "quantity" &&
                        "bg-red-400/10 text-red-300 placeholder:text-red-300",
                    )}
                  />
                </td>
                {outcome ? (
                  <td className="px-2.5 text-xs whitespace-nowrap">
                    {outcome(row)}
                  </td>
                ) : null}
                <td className="text-center">
                  <button
                    type="button"
                    onClick={() =>
                      onChange(rows.filter((other) => other.key !== row.key))
                    }
                    aria-label={t("removeLine")}
                    className="inline-flex size-7 items-center justify-center rounded-md text-nexus-muted hover:bg-red-400/10 hover:text-red-300"
                  >
                    <X className="size-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <datalist id="refined-materials">
        {REFINED_MATERIALS.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <button
        type="button"
        onClick={() => onChange([...rows, toDraft({})])}
        className="flex h-9 w-full items-center gap-2 px-2.5 text-[13px] text-nexus-muted hover:bg-nexus-accent/5 hover:text-nexus-bright"
      >
        <Plus className="size-3.5" />
        {t("addLine")}
      </button>
    </div>
  );
}
