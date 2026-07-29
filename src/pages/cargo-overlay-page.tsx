import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Boxes, Pencil, Plus, X } from "lucide-react";
import { useCargoSheet } from "@/hooks/use-cargo-sheet";
import {
  addLines,
  closeSheet,
  removeLine,
  removeMission,
  setMaxContainer,
  startNewMission,
  updateLine,
} from "@/lib/cargo-sheet";
import {
  CONTAINER_SIZES,
  isContainerSize,
  missionName,
  type ContainerSize,
} from "@/lib/cargo";
import {
  CapacitySummary,
  CargoLineForm,
  CloseSheetButton,
  MissionGroups,
} from "@/components/cargo/sheet-view";
import { Button, Select } from "@/components/ui";
import { useTransparentWindow } from "@/hooks/use-transparent-window";
import { cn } from "@/lib/utils";

/**
 * The cargo sheet as a standalone always-on-top window, so the manifest stays
 * readable while flying.
 *
 * It opens read-only, which is what a manifest is for mid-haul: the list and
 * the remaining capacity, nothing to click by accident over a game. The
 * controls live behind an explicit «Modifier», and are the same ones the main
 * screen has — minus the ship, which is the one thing that would need the
 * network, and which the sheet deliberately carries a copy of.
 *
 * Like the scratch pad, it survives losing focus — it is dismissed by its
 * shortcut, its close button, or the tray.
 */
export default function CargoOverlayPage() {
  const { sheet, loading } = useCargoSheet();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  useTransparentWindow();

  function close() {
    void invoke("close_cargo_overlay");
  }

  function stopEditing() {
    setEditing(false);
    setAdding(false);
  }

  const currentMission = sheet ? missionName(sheet.missionCounter) : undefined;

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden rounded-xl border border-white/10 bg-[#061E30]/95 shadow-2xl backdrop-blur-xl"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();

        // Leaving the controls first: closing the window on the same key that
        // backs out of a form would throw away what was being typed.
        if (editing) stopEditing();
        else close();
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

        {sheet ? (
          <button
            type="button"
            onClick={() => (editing ? stopEditing() : setEditing(true))}
            title={editing ? "Terminer les modifications" : "Modifier"}
            aria-pressed={editing}
            className={cn(
              "rounded p-1 transition hover:bg-white/10",
              editing
                ? "bg-white/10 text-slate-100"
                : "text-slate-400 hover:text-slate-100",
            )}
          >
            <span className="sr-only">
              {editing ? "Terminer les modifications" : "Modifier"}
            </span>
            <Pencil className="size-4" />
          </button>
        ) : null}

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

            {editing ? (
              <div className="shrink-0 space-y-2 rounded-lg border border-nexus-accent/15 bg-nexus-abyss/40 p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={adding ? "primary" : "ghost"}
                    aria-pressed={adding}
                    onClick={() => setAdding((open) => !open)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Ajouter
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void startNewMission()}
                  >
                    Nouvelle mission
                  </Button>

                  <Select
                    aria-label="Plus gros conteneur"
                    value={String(sheet.maxContainer)}
                    onChange={(event) => {
                      const size = Number(event.target.value);
                      if (isContainerSize(size)) {
                        void setMaxContainer(size as ContainerSize);
                      }
                    }}
                    className="w-auto py-1 pl-2 text-xs"
                  >
                    {CONTAINER_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size} SCU
                      </option>
                    ))}
                  </Select>

                  <CloseSheetButton
                    lineCount={sheet.lines.length}
                    onConfirm={() => {
                      stopEditing();
                      void closeSheet();
                    }}
                  />
                </div>

                {adding ? (
                  <>
                    <p className="text-[11px] text-nexus-accent/50">
                      Sans mission indiquée, la ligne rejoint «{" "}
                      {currentMission} ».
                    </p>
                    <CargoLineForm
                      compact
                      submitLabel="Ajouter"
                      submitIcon={<Plus className="h-3.5 w-3.5" />}
                      onSubmit={(line) => void addLines([line])}
                      onCancel={() => setAdding(false)}
                    />
                  </>
                ) : null}
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto">
              {sheet.lines.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Feuille vide : rien à charger pour l'instant.
                </p>
              ) : (
                <MissionGroups
                  lines={sheet.lines}
                  compact
                  missionPlaceholder={currentMission}
                  onRemoveLine={editing ? (id) => void removeLine(id) : undefined}
                  onRemoveMission={
                    editing ? (mission) => void removeMission(mission) : undefined
                  }
                  onEditLine={
                    editing
                      ? (id, line) => void updateLine(id, line)
                      : undefined
                  }
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
