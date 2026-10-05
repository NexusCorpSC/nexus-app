import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslations } from "use-intl";
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
  TransportsLoading,
  transportSourceLabel,
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
 *
 * Mounted with the capture as its `key`: a second capture is a second import,
 * not an update of this one.
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
  const t = useTranslations("Cargo.capture");
  const [state, setState] = useState<"reading" | "ship" | "added" | "failed">(
    "reading",
  );
  const [error, setError] = useState<string | null>(null);

  // Guards against React's double mount in development, where the lines would
  // otherwise be added twice. A new capture arrives as a new mount.
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
          {t("summary", { count: lines.length, volume })}
        </p>
      </div>

      <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-slate-300">
        {lines.map((line, index) => (
          <li key={`${line.destination}-${index}`} className="truncate">
            {t.rich("line", {
              volume: line.volume,
              content: line.content,
              hasContent: line.content ? "yes" : "no",
              destination: line.destination,
              location: line.location,
              hasLocation: line.location ? "yes" : "no",
              amount: (chunks) => (
                <span className="text-slate-100">{chunks}</span>
              ),
            })}
          </li>
        ))}
      </ul>

      {ignored > 0 ? (
        <p className="text-xs text-amber-300/90">
          {t("ignored", { count: ignored })}
        </p>
      ) : null}

      {state === "reading" ? (
        <p className="text-xs text-slate-400">{t("reading")}</p>
      ) : null}

      {/* Rendered only when a ship is actually needed: loading it is what
          reaches for the network, and adding to an existing sheet must not. */}
      {state === "ship" ? <ShipPrompt onSubmit={createAndAdd} /> : null}

      {state === "added" ? (
        <div className="flex items-center gap-2">
          <p className="flex-1 text-xs text-emerald-300">
            {t("added")}
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
            {t("overlay")}
          </Button>
          <Button type="button" size="sm" onClick={onDone}>
            {t("close")}
          </Button>
        </div>
      ) : null}

      {state === "failed" ? (
        <p className="rounded-lg border border-red-400/30 bg-red-500/10 p-2 text-xs text-red-200">
          {error ? t("failedWith", { error }) : t("failed")}
        </p>
      ) : null}
    </div>
  );
}

function ShipPrompt({ onSubmit }: { onSubmit: (ship: SheetShip) => void }) {
  const t = useTranslations("Cargo.capture");
  const { transports, source, loading } = useTransports();
  const sourceWarning = transportSourceLabel(source);

  return (
    <div className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-3">
      <p className="text-xs text-slate-300">
        {t("askShip")}
      </p>

      {loading || !transports ? (
        <TransportsLoading />
      ) : (
        <>
          <ShipPicker
            transports={transports}
            submitLabel={t("createAndAdd")}
            onSubmit={onSubmit}
          />
          {sourceWarning ? (
            <p className="text-[11px] text-amber-300/80">
              {sourceWarning}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
