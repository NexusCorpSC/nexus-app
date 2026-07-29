import { invoke } from "@tauri-apps/api/core";
import { Boxes, X } from "lucide-react";
import { useCargoSheet } from "@/hooks/use-cargo-sheet";
import { CapacitySummary, MissionGroups } from "@/components/cargo/sheet-view";
import { useTransparentWindow } from "@/hooks/use-transparent-window";

/**
 * The cargo sheet as a standalone always-on-top window, so the manifest stays
 * readable while flying. Read-only on purpose: what is needed mid-haul is the
 * list and the remaining capacity, not a form.
 *
 * Like the scratch pad, it survives losing focus — it is dismissed by its
 * shortcut, its close button, or the tray.
 */
export default function CargoOverlayPage() {
  const { sheet, loading } = useCargoSheet();

  useTransparentWindow();

  function close() {
    void invoke("close_cargo_overlay");
  }

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden rounded-xl border border-white/10 bg-[#061E30]/95 shadow-2xl backdrop-blur-xl"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
    >
      {/* No decorations, so the header doubles as the title bar. */}
      <div
        data-tauri-drag-region
        className="flex shrink-0 cursor-grab items-center gap-2 border-b border-white/10 px-3 py-2"
      >
        <Boxes className="pointer-events-none size-4 text-slate-400" />
        <p className="pointer-events-none flex-1 truncate text-sm font-medium text-slate-200">
          Feuille de cargo
        </p>
        <button
          type="button"
          onClick={close}
          title="Fermer"
          className="rounded p-1 text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
        >
          <span className="sr-only">Fermer</span>
          <X className="size-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        {loading ? (
          <p className="text-xs text-slate-400">Chargement…</p>
        ) : !sheet ? (
          <p className="text-xs text-slate-400">
            Aucune feuille en cours. Ouvrez « Feuille de cargo » dans la fenêtre
            principale, ou capturez un journal de mission.
          </p>
        ) : (
          <>
            <CapacitySummary
              lines={sheet.lines}
              capacity={sheet.capacity}
              shipName={sheet.shipName}
              compact
            />

            <div className="min-h-0 flex-1 overflow-y-auto">
              {sheet.lines.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Feuille vide : rien à charger pour l'instant.
                </p>
              ) : (
                <MissionGroups lines={sheet.lines} compact />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
