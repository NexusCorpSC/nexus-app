import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Boxes, PanelRight } from "lucide-react";
import {
  addLines,
  readSheet,
  startSheet,
  type SheetShip,
} from "@/lib/cargo-sheet";
import { type ParsedBulkLine } from "@/lib/cargo";
import {
  ShipPicker,
  TRANSPORT_SOURCE_LABELS,
  TransportsLoading,
  useTransports,
} from "@/components/cargo/ship-picker";
import { Button } from "@/components/ui";

/**
 * What a capture of the in-game mission log becomes: cargo lines, added to the
 * sheet without further ceremony.
 *
 * If there is no sheet, there is one thing the application cannot guess — the
 * ship — so it asks for it, and starts the sheet with the capture already in
 * it. Everything else is derived.
 */
export function CargoCaptureImport({
  lines,
  ignored,
  onDone,
}: {
  lines: ParsedBulkLine[];
  /** Objectives that looked like deliveries but could not be read. */
  ignored: number;
  onDone: () => void;
}) {
  const [state, setState] = useState<"reading" | "ship" | "added" | "failed">(
    "reading",
  );
  const [error, setError] = useState<string | null>(null);
  const { transports, source, loading } = useTransports();

  // Guards the effect below against React's double mount in development: the
  // lines would otherwise be added twice.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void readSheet()
      .then(async (sheet) => {
        if (!sheet) {
          setState("ship");
          return;
        }

        await addLines(lines);
        setState("added");
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setState("failed");
      });
  }, [lines]);

  async function createAndAdd(ship: SheetShip) {
    try {
      await startSheet(ship);
      await addLines(lines);
      setState("added");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState("failed");
    }
  }

  const volume = lines.reduce((total, line) => total + line.volume, 0);

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Boxes className="size-4 shrink-0 text-sky-300" />
        <p className="text-sm font-medium text-slate-100">
          {lines.length} objectif{lines.length > 1 ? "s" : ""} de livraison ·{" "}
          {volume} SCU
        </p>
      </div>

      <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-slate-300">
        {lines.map((line, index) => (
          <li key={`${line.destination}-${index}`} className="truncate">
            <span className="text-slate-100">{line.volume} SCU</span>{" "}
            {line.content ? `de ${line.content} ` : ""}
            vers {line.destination}
            {line.location ? ` (depuis ${line.location})` : ""}
          </li>
        ))}
      </ul>

      {ignored > 0 ? (
        <p className="text-xs text-amber-300/90">
          {ignored} ligne{ignored > 1 ? "s" : ""} illisible
          {ignored > 1 ? "s" : ""} — recadrez la capture pour les récupérer.
        </p>
      ) : null}

      {state === "reading" ? (
        <p className="text-xs text-slate-400">Lecture de la feuille…</p>
      ) : null}

      {state === "ship" ? (
        <div className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-3">
          <p className="text-xs text-slate-300">
            Aucune feuille en cours. Quel vaisseau utilisez-vous ?
          </p>

          {loading || !transports ? (
            <TransportsLoading />
          ) : (
            <>
              <ShipPicker
                transports={transports}
                submitLabel="Créer la feuille et ajouter"
                onSubmit={(ship) => void createAndAdd(ship)}
              />
              {TRANSPORT_SOURCE_LABELS[source] ? (
                <p className="text-[11px] text-amber-300/80">
                  {TRANSPORT_SOURCE_LABELS[source]}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {state === "added" ? (
        <div className="flex items-center gap-2">
          <p className="flex-1 text-xs text-emerald-300">
            Ajouté à la feuille de cargo.
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              void invoke("toggle_cargo_overlay");
              onDone();
            }}
          >
            <PanelRight className="h-3.5 w-3.5" />
            Superposition
          </Button>
          <Button type="button" size="sm" onClick={onDone}>
            Fermer
          </Button>
        </div>
      ) : null}

      {state === "failed" ? (
        <p className="rounded-lg border border-red-400/30 bg-red-500/10 p-2 text-xs text-red-200">
          La feuille n'a pas pu être écrite{error ? ` : ${error}` : ""}.
        </p>
      ) : null}
    </div>
  );
}
