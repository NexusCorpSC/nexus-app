import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Factory,
  Merge,
  Plus,
  X,
} from "lucide-react";
import {
  bulkAddInventoryItems,
  listInventoryItems,
  listLocations,
  type BulkInventoryRow,
} from "@/lib/api/inventory";
import { Button, Card, Input, PageHeader } from "@/components/ui";
import { ItemNameCombobox } from "@/components/inventory/item-name-combobox";
import { LocationCombobox } from "@/components/inventory/location-combobox";
import {
  readWorkOrderImport,
  WORK_ORDER_PARAM,
} from "@/lib/refinery-work-order";
import { cn } from "@/lib/utils";
import type { Location } from "@/types/nexus";

type Row = {
  key: number;
  name: string;
  quality: string;
  quantity: string;
  unit: string;
  /** Picked for this row; "" falls back to the default place. */
  locationId: string;
  /** A place named in a paste that matched none the reader can use. */
  locationText?: string;
  orgVisible: boolean;
  /**
   * Read from a refinery work order: its yield must be there, where a typed
   * row without a quantity counts one.
   */
  fromCapture?: boolean;
};

/** What the capture of a work order brought, shown above the table. */
type CaptureSummary = { lots: number; sum: number; total?: number };

type Status =
  | { kind: "empty" }
  | {
      kind: "error";
      message: string;
      field?: "name" | "quality" | "quantity" | "location";
    }
  | { kind: "new"; row: BulkInventoryRow; message: string }
  | { kind: "merge"; row: BulkInventoryRow; from: number; to: number };

const CELL =
  "h-10 w-full rounded-none border-0 bg-transparent px-3 text-[13.5px] text-nexus-white placeholder:text-nexus-dim/70 focus:bg-nexus-panel focus:outline-2 focus:-outline-offset-2 focus:outline-nexus-accent";

const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

/**
 * A number as a French spreadsheet writes it too: "1 234,5", thousands split
 * by spaces (plain, non-breaking or narrow) and a decimal comma.
 */
function parseNumber(value: string) {
  return Number(value.replace(/[\s\u00a0\u202f]/g, "").replace(",", "."));
}

function sameText(a: string | undefined, b: string | undefined) {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

function roundQty(value: number) {
  return Math.round(value * 1e10) / 1e10;
}

/**
 * Bulk add: several items typed one after another, or pasted from a
 * spreadsheet, and sent in one go to `POST /api/inventory/items/bulk`.
 *
 * Each row says, before anything is sent, what will become of it: a new item,
 * a new lot of something already held, or a top-up of an existing lot — same
 * name, quality, unit and note at the same place, the rule the API applies. Rows in
 * error stay in the table once the others are added.
 */
export default function InventoryQuickAddPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const nextKey = useRef(0);
  const blankRow = (orgVisible: boolean): Row => ({
    key: nextKey.current++,
    name: "",
    quality: "",
    quantity: "",
    unit: "",
    locationId: "",
    orgVisible,
  });

  const [defaultLocationId, setDefaultLocationId] = useState("");
  const [defaultUnit, setDefaultUnit] = useState("");
  const [defaultQuality, setDefaultQuality] = useState("");
  const [defaultDescription, setDefaultDescription] = useState("");
  const [defaultOrg, setDefaultOrg] = useState(false);
  const [rows, setRows] = useState<Row[]>(() => [
    blankRow(false),
    blankRow(false),
    blankRow(false),
  ]);
  const [notice, setNotice] = useState<string | null>(null);
  const [capture, setCapture] = useState<CaptureSummary | null>(null);
  // Places found by searching, beyond the first page the API lists.
  const [picked, setPicked] = useState<Location[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();

  const nameInputs = useRef(new Map<number, HTMLInputElement>());
  const [focusKey, setFocusKey] = useState<number | null>(null);

  useEffect(() => {
    if (focusKey === null) return;
    nameInputs.current.get(focusKey)?.focus();
    setFocusKey(null);
  }, [focusKey, rows]);

  // A refinery work order read from a capture (see `overlay-page.tsx`): its
  // lots take the place of the blank rows, in cSCU as the game counts them,
  // and wait for a place to be picked. Read once, then dropped from the route,
  // so going back does not add them a second time.
  const workOrderParam = searchParams.get(WORK_ORDER_PARAM);
  // React runs an effect twice in development: the lots must land once.
  const consumedRef = useRef<string | null>(null);
  useEffect(() => {
    if (workOrderParam === null) {
      // Dropped from the route: the same order captured again is new.
      consumedRef.current = null;
      return;
    }
    if (consumedRef.current === workOrderParam) return;
    consumedRef.current = workOrderParam;
    const workOrder = readWorkOrderImport(workOrderParam);
    setSearchParams({}, { replace: true });
    if (!workOrder) return;

    setRows((prev) => {
      const kept = prev.filter(
        (row) =>
          row.name.trim() ||
          row.quality.trim() ||
          row.quantity.trim() ||
          row.locationId ||
          row.locationText,
      );
      const captured = workOrder.lines.map((line) => ({
        key: nextKey.current++,
        name: line.name,
        quality: line.quality?.toString() ?? "",
        quantity: line.quantity?.toString() ?? "",
        unit: "cSCU",
        locationId: "",
        orgVisible: defaultOrg,
        fromCapture: true,
      }));
      return [...kept, ...captured];
    });
    setCapture({
      lots: workOrder.lines.length,
      sum: workOrder.lines.reduce((acc, line) => acc + (line.quantity ?? 0), 0),
      total: workOrder.total,
    });
    setNotice(null);
  }, [workOrderParam, setSearchParams, defaultOrg]);

  const itemsQuery = useQuery({
    queryKey: ["inventory-items", ""],
    queryFn: () => listInventoryItems(),
  });
  const existing = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);

  const locationsQuery = useQuery({
    queryKey: ["locations"],
    queryFn: () => listLocations(),
    staleTime: 10 * 60_000,
  });

  // The places the reader already stores things at come first: the list the
  // API gives is capped, and favours the catalogue.
  const held = useMemo(() => {
    const byId = new Map<string, Location>();
    for (const item of existing) {
      if (item.location) byId.set(item.location.id, item.location);
    }
    return [...byId.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "fr"),
    );
  }, [existing]);

  const locations = useMemo(() => {
    const byId = new Map<string, Location>();
    for (const location of [
      ...held,
      ...picked,
      ...(locationsQuery.data ?? []),
    ]) {
      if (!byId.has(location.id)) byId.set(location.id, location);
    }
    return [...byId.values()];
  }, [held, picked, locationsQuery.data]);

  const locationById = (id: string) =>
    id ? (locations.find((l) => l.id === id) ?? null) : null;

  /** Remembers a place found by searching, so its name can be shown. */
  const remember = (location: Location | null) => {
    if (location && !locations.some((l) => l.id === location.id)) {
      setPicked((prev) =>
        prev.some((l) => l.id === location.id) ? prev : [...prev, location],
      );
    }
  };

  const knownNames = useMemo(
    () =>
      [...new Set(existing.map((item) => item.name))].sort((a, b) =>
        a.localeCompare(b, "fr"),
      ),
    [existing],
  );

  const defaultLocation = locationById(defaultLocationId);
  const defaultQualityValid =
    !defaultQuality.trim() || /^\d+$/.test(defaultQuality.trim());

  /** The unit the reader already counts a thing in, to fill a blank one. */
  const heldUnit = (name: string) =>
    existing.find((item) => item.unit && sameText(item.name, name))?.unit;

  const unitOf = (row: Row) =>
    row.unit.trim() || defaultUnit.trim() || heldUnit(row.name) || undefined;

  const statusOf = (row: Row): Status => {
    const blank =
      !row.name.trim() &&
      !row.quality.trim() &&
      !row.quantity.trim() &&
      !row.unit.trim() &&
      !row.locationId &&
      !row.locationText;
    if (blank) return { kind: "empty" };

    const name = row.name.trim();
    if (!name) return { kind: "error", message: "Nom requis", field: "name" };

    // A blank quality takes the default one, if any.
    const qualityText = row.quality.trim() || defaultQuality.trim();
    let quality: number | undefined;
    if (qualityText) {
      if (!/^\d+$/.test(qualityText)) {
        return {
          kind: "error",
          message: row.quality.trim()
            ? "Qualité : entier ≥ 0"
            : "Qualité par défaut : entier ≥ 0",
          field: "quality",
        };
      }
      quality = parseInt(qualityText, 10);
    }

    if (row.fromCapture && !row.quantity.trim()) {
      return {
        kind: "error",
        message: "Rendement illisible sur la capture",
        field: "quantity",
      };
    }
    const quantity = row.quantity.trim() ? parseNumber(row.quantity) : 1;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { kind: "error", message: "Quantité invalide", field: "quantity" };
    }

    if (!row.locationId && row.locationText) {
      return {
        kind: "error",
        message: `Lieu introuvable : ${row.locationText}`,
        field: "location",
      };
    }
    const locationId = row.locationId || defaultLocationId;
    if (!locationId) {
      return { kind: "error", message: "Lieu requis", field: "location" };
    }

    const unit = unitOf(row);
    const payload: BulkInventoryRow = {
      name,
      description: defaultDescription.trim() || undefined,
      quality,
      quantity,
      unit,
      locationId,
      orgVisible: row.orgVisible,
    };

    const match = existing.find(
      (item) =>
        item.locationId === locationId &&
        sameText(item.name, name) &&
        sameText(item.unit, unit) &&
        sameText(item.description, payload.description) &&
        (item.quality ?? undefined) === quality,
    );
    if (match) {
      return {
        kind: "merge",
        row: payload,
        from: match.quantity,
        to: roundQty(match.quantity + quantity),
      };
    }

    const held = existing.some((item) => sameText(item.name, name));
    return {
      kind: "new",
      row: payload,
      message: held ? "Nouveau lot" : "Nouvel objet",
    };
  };

  const statuses = rows.map(statusOf);
  const ready = statuses.flatMap((s) =>
    s.kind === "new" || s.kind === "merge" ? [s.row] : [],
  );
  const merges = statuses.filter((s) => s.kind === "merge").length;
  const errors = statuses.filter((s) => s.kind === "error").length;

  const submitMutation = useMutation({
    mutationFn: bulkAddInventoryItems,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      const kept = rows.filter((_, i) => statuses[i].kind === "error");
      if (kept.length === 0) {
        navigate("/inventory");
        return;
      }
      setRows(kept);
      setNotice(
        `${result.created} créé(s), ${result.merged} fusionné(s). Les lignes en erreur restent à corriger.`,
      );
    },
  });

  const submit = () => {
    if (ready.length === 0 || submitMutation.isPending) return;
    setNotice(null);
    submitMutation.mutate(ready);
  };

  const update = (key: number, patch: Partial<Row>) =>
    setRows((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );

  const addRow = () => {
    const row = blankRow(defaultOrg);
    setRows((prev) => [...prev, row]);
    setFocusKey(row.key);
  };

  const removeRow = (key: number) =>
    setRows((prev) => {
      const left = prev.filter((row) => row.key !== key);
      return left.length > 0 ? left : [blankRow(defaultOrg)];
    });

  const handleRowKeyDown = (row: Row, index: number) => (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      const next = rows[index + 1];
      if (next) setFocusKey(next.key);
      else addRow();
      return;
    }
    if ((e.key === "d" || e.key === "D") && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const copy = { ...row, key: nextKey.current++ };
      setRows((prev) => {
        const at = prev.findIndex((r) => r.key === row.key);
        return [...prev.slice(0, at + 1), copy, ...prev.slice(at + 1)];
      });
      setFocusKey(copy.key);
    }
  };

  /**
   * A paste of several cells or lines fills rows from this one down, in the
   * columns of the table: name, quality, quantity, unit, place. A first line
   * whose number columns hold words is taken for a header and skipped. Places
   * are matched by exact name against those the reader can pick.
   */
  const handlePaste = (row: Row) => (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.trim().includes("\n")) return;
    e.preventDefault();

    let lines = text
      .split(/\r?\n/)
      .map((line) => line.split("\t").map((cell) => cell.trim()))
      .filter((cells) => cells.some(Boolean));

    const looksNumeric = (cell?: string) =>
      !cell || Number.isFinite(parseNumber(cell));
    if (
      lines.length > 1 &&
      !(looksNumeric(lines[0][1]) && looksNumeric(lines[0][2]))
    ) {
      lines = lines.slice(1);
    }
    if (lines.length === 0) return;

    const pasted: Row[] = lines.map(
      ([name = "", quality = "", quantity = "", unit = "", place = ""], i) => {
        const location = place
          ? locations.find((l) => sameText(l.name, place))
          : undefined;
        return {
          key: i === 0 ? row.key : nextKey.current++,
          name,
          quality,
          quantity,
          unit,
          locationId: location?.id ?? "",
          locationText: place && !location ? place : undefined,
          orgVisible: row.orgVisible,
        };
      },
    );

    setRows((prev) => {
      const at = prev.findIndex((r) => r.key === row.key);
      // Blank rows right after this one are filled rather than pushed down.
      let end = at + 1;
      while (
        end < prev.length &&
        end - at < pasted.length &&
        statusOf(prev[end]).kind === "empty"
      ) {
        end++;
      }
      return [...prev.slice(0, at), ...pasted, ...prev.slice(end)];
    });
  };

  return (
    <>
      <Link
        to="/inventory"
        className="mb-3 inline-flex items-center gap-1.5 text-xs text-nexus-muted hover:text-nexus-bright"
      >
        <ArrowLeft className="size-3.5" />
        Inventaire
      </Link>
      <PageHeader
        title="Ajout en masse"
        description="Saisissez plusieurs ressources à la suite, ou collez-les depuis un tableur."
      />

      {capture ? (
        <Card className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-nexus-accent/25 px-4 py-3 text-[13px] text-nexus-bright">
          <Factory className="size-4 shrink-0 text-nexus-accent" />
          <span className="flex-1">
            {capture.lots} lot{capture.lots > 1 ? "s" : ""} lu
            {capture.lots > 1 ? "s" : ""} sur l'ordre de travail · somme{" "}
            {number.format(capture.sum)} cSCU
            {capture.total !== undefined ? (
              <span
                className={cn(
                  capture.total !== capture.sum && "text-amber-300",
                )}
              >
                {" "}
                · total du jeu {number.format(capture.total)} cSCU
              </span>
            ) : null}
            . Choisissez le lieu et vérifiez les chiffres : l'OCR confond
            parfois le zéro barré du jeu avec un 8.
          </span>
          <button
            type="button"
            onClick={() => setCapture(null)}
            aria-label="Masquer"
            className="inline-flex size-7 items-center justify-center rounded-md text-nexus-muted hover:bg-nexus-accent/10 hover:text-nexus-bright"
          >
            <X className="size-4" />
          </button>
        </Card>
      ) : null}

      <Card className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <span className="font-display text-[11px] font-semibold tracking-[0.12em] text-nexus-muted uppercase">
          Par défaut
        </span>
        <label className="flex items-center gap-2 text-[13px] text-nexus-muted">
          Lieu
          <LocationCombobox
            value={defaultLocation}
            onChange={(location) => {
              remember(location);
              setDefaultLocationId(location?.id ?? "");
            }}
            preferred={held}
            placeholder="Rechercher un lieu…"
            aria-label="Lieu par défaut"
            className="h-8 w-60 rounded-lg border border-nexus-accent/15 bg-nexus-card px-3 text-[13.5px] text-nexus-white placeholder:text-nexus-dim/80 focus:border-nexus-accent/50 focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-2 text-[13px] text-nexus-muted">
          Qualité
          <Input
            inputMode="numeric"
            value={defaultQuality}
            placeholder="—"
            aria-invalid={!defaultQualityValid || undefined}
            onChange={(event) => setDefaultQuality(event.target.value)}
            className={cn(
              "h-8 w-20 py-0 text-right font-mono",
              !defaultQualityValid && "border-red-400/60 text-red-300",
            )}
          />
        </label>
        <label className="flex items-center gap-2 text-[13px] text-nexus-muted">
          Unité
          <Input
            value={defaultUnit}
            placeholder="SCU…"
            onChange={(event) => setDefaultUnit(event.target.value)}
            className="h-8 w-24 py-0"
          />
        </label>
        <label className="flex items-center gap-2 text-[13px] text-nexus-muted">
          Description
          <Input
            value={defaultDescription}
            placeholder="Notes sur ces objets…"
            onChange={(event) => setDefaultDescription(event.target.value)}
            className="h-8 w-64 py-0"
          />
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-nexus-bright">
          <input
            type="checkbox"
            checked={defaultOrg}
            onChange={(event) => {
              const next = event.target.checked;
              setDefaultOrg(next);
              setRows((prev) =>
                prev.map((row) => ({ ...row, orgVisible: next })),
              );
            }}
            className="size-3.5 accent-nexus-accent"
          />
          Visible par l'org
        </label>
        <div className="ml-auto flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-nexus-dim">
          <HintKey keys="Tab">cellule suivante</HintKey>
          <HintKey keys="↵">ligne suivante</HintKey>
          <HintKey keys="Ctrl D">dupliquer</HintKey>
          <HintKey keys="Ctrl V">
            coller Nom · Qualité · Quantité · Unité · Lieu
          </HintKey>
        </div>
      </Card>

      <Card className="mb-4 overflow-x-auto">
        <table className="w-full min-w-[920px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-nexus-accent/15 bg-nexus-deep text-left font-display text-[11px] font-semibold tracking-[0.12em] text-nexus-muted uppercase">
              <th scope="col" className="w-10 py-2.5 text-center font-semibold">
                #
              </th>
              <th scope="col" className="px-3 font-semibold">
                Nom
              </th>
              <th scope="col" className="w-24 px-3 text-right font-semibold">
                Qualité
              </th>
              <th scope="col" className="w-28 px-3 text-right font-semibold">
                Quantité
              </th>
              <th scope="col" className="w-24 px-3 font-semibold">
                Unité
              </th>
              <th scope="col" className="w-56 px-3 font-semibold">
                Lieu
              </th>
              <th scope="col" className="w-14 text-center font-semibold">
                Org
              </th>
              <th scope="col" className="w-52 px-3 font-semibold">
                Contrôle
              </th>
              <th scope="col" className="w-10">
                <span className="sr-only">Supprimer la ligne</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const status = statuses[index];
              const errorField =
                status.kind === "error" ? status.field : undefined;
              return (
                <tr
                  key={row.key}
                  onKeyDown={handleRowKeyDown(row, index)}
                  className={cn(
                    "border-b border-nexus-accent/8 [&>td+td]:border-l [&>td+td]:border-nexus-accent/8",
                    status.kind === "error" && "bg-red-500/5",
                  )}
                >
                  <td className="text-center font-mono text-xs text-nexus-dim/70">
                    {index + 1}
                  </td>
                  <td>
                    <ItemNameCombobox
                      inputRef={(el) => {
                        if (el) nameInputs.current.set(row.key, el);
                        else nameInputs.current.delete(row.key);
                      }}
                      autoFocus={index === 0}
                      value={row.name}
                      held={knownNames}
                      onChange={(name) => update(row.key, { name })}
                      onPaste={handlePaste(row)}
                      placeholder="Titanium…"
                      aria-label="Nom"
                      invalid={errorField === "name"}
                      className={CELL}
                    />
                  </td>
                  <td>
                    <input
                      inputMode="numeric"
                      value={row.quality}
                      onChange={(e) =>
                        update(row.key, { quality: e.target.value })
                      }
                      placeholder={defaultQuality.trim() || "—"}
                      aria-label="Qualité"
                      aria-invalid={errorField === "quality" || undefined}
                      className={cn(
                        CELL,
                        "text-right font-mono",
                        errorField === "quality" && "bg-red-500/10 text-red-300",
                      )}
                    />
                  </td>
                  <td>
                    <input
                      inputMode="decimal"
                      value={row.quantity}
                      onChange={(e) =>
                        update(row.key, { quantity: e.target.value })
                      }
                      placeholder="1"
                      aria-label="Quantité"
                      aria-invalid={errorField === "quantity" || undefined}
                      className={cn(
                        CELL,
                        "text-right font-mono",
                        errorField === "quantity" &&
                          "bg-red-500/10 text-red-300",
                      )}
                    />
                  </td>
                  <td>
                    <input
                      value={row.unit}
                      onChange={(e) =>
                        update(row.key, { unit: e.target.value })
                      }
                      placeholder={unitOf({ ...row, unit: "" }) ?? "—"}
                      aria-label="Unité"
                      className={CELL}
                    />
                  </td>
                  <td>
                    <LocationCombobox
                      value={locationById(row.locationId)}
                      onChange={(location) => {
                        remember(location);
                        update(row.key, {
                          locationId: location?.id ?? "",
                          locationText: undefined,
                        });
                      }}
                      preferred={held}
                      placeholder={
                        row.locationText
                          ? `« ${row.locationText} » ?`
                          : defaultLocation
                            ? `Défaut · ${defaultLocation.name}`
                            : "Rechercher un lieu…"
                      }
                      aria-label="Lieu"
                      invalid={errorField === "location"}
                      className={cn(
                        CELL,
                        errorField === "location" &&
                          "placeholder:text-red-300/80",
                      )}
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      checked={row.orgVisible}
                      onChange={(e) =>
                        update(row.key, { orgVisible: e.target.checked })
                      }
                      aria-label="Visible par l'org"
                      className="size-3.5 accent-nexus-accent"
                    />
                  </td>
                  <td className="px-3 text-xs">
                    <RowStatus status={status} />
                  </td>
                  <td className="text-center">
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      aria-label="Supprimer la ligne"
                      className="inline-flex size-8 items-center justify-center rounded-md text-nexus-dim hover:bg-red-500/10 hover:text-red-300"
                    >
                      <X className="size-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button
          type="button"
          onClick={addRow}
          className="flex h-11 w-full items-center gap-2 px-4 text-[13px] text-nexus-muted hover:bg-nexus-accent/5 hover:text-nexus-bright"
        >
          <Plus className="size-4" />
          Nouvelle ligne
        </button>
      </Card>

      <Card className="sticky bottom-4 flex flex-wrap items-center gap-x-5 gap-y-3 border-nexus-accent/20 bg-nexus-deep px-4 py-3 shadow-lg shadow-black/30">
        <div className="flex flex-wrap gap-4 text-[13px] text-nexus-bright">
          <span>
            <strong className="text-emerald-300">{ready.length}</strong>{" "}
            prêt{ready.length > 1 ? "s" : ""}
          </span>
          <span>
            <strong className="text-amber-300">{merges}</strong> fusion
            {merges > 1 ? "s" : ""} avec un lot existant
          </span>
          <span>
            <strong className="text-red-300">{errors}</strong> à corriger
          </span>
        </div>
        <p className="flex-1 text-xs text-nexus-muted">
          {submitMutation.error ? (
            <span className="text-red-300">
              {submitMutation.error instanceof Error
                ? submitMutation.error.message
                : "L'ajout a échoué."}
            </span>
          ) : (
            (notice ??
            (errors > 0
              ? "Les lignes en erreur restent dans le tableau après l'ajout."
              : null))
          )}
        </p>
        <Button variant="ghost" onClick={() => navigate("/inventory")}>
          Annuler
        </Button>
        <Button
          onClick={submit}
          disabled={ready.length === 0 || submitMutation.isPending}
        >
          {submitMutation.isPending
            ? "Enregistrement…"
            : ready.length === 0
              ? "Ajouter"
              : `Ajouter ${ready.length} objet${ready.length > 1 ? "s" : ""}`}
          <span className="font-mono text-[10.5px] opacity-60">Ctrl ↵</span>
        </Button>
      </Card>
    </>
  );
}

function HintKey({ keys, children }: { keys: string; children: string }) {
  return (
    <span>
      <kbd className="rounded bg-nexus-panel px-1.5 py-0.5 font-mono text-[10.5px] text-nexus-bright">
        {keys}
      </kbd>{" "}
      {children}
    </span>
  );
}

function RowStatus({ status }: { status: Status }) {
  switch (status.kind) {
    case "empty":
      return null;
    case "error":
      return (
        <span className="flex items-center gap-1.5 text-red-300">
          <AlertCircle className="size-4 shrink-0" />
          <span className="truncate">{status.message}</span>
        </span>
      );
    case "merge":
      return (
        <span className="flex items-center gap-1.5 text-amber-300">
          <Merge className="size-4 shrink-0" />
          <span className="truncate">
            Fusion : ×{number.format(status.from)} → ×
            {number.format(status.to)}
          </span>
        </span>
      );
    case "new":
      return (
        <span className="flex items-center gap-1.5 text-nexus-muted">
          <Check className="size-4 shrink-0 text-emerald-300" />
          <span className="truncate">{status.message}</span>
        </span>
      );
  }
}
