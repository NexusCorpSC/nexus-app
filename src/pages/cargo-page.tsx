import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PanelRight, Plus } from "lucide-react";
import {
  CONTAINER_SIZES,
  isContainerSize,
  missionName,
  type ContainerSize,
} from "@/lib/cargo";
import {
  addLines,
  closeSheet,
  removeLine,
  removeMission,
  setMaxContainer,
  setShip,
  startNewMission,
  startSheet,
  updateLine,
} from "@/lib/cargo-sheet";
import { parseQuickEntry } from "@/lib/mission-objectives";
import { useCargoSheet } from "@/hooks/use-cargo-sheet";
import {
  ShipPicker,
  TRANSPORT_SOURCE_LABELS,
  useTransports,
} from "@/components/cargo/ship-picker";
import {
  CapacitySummary,
  CargoLineForm,
  MissionGroups,
} from "@/components/cargo/sheet-view";
import {
  Button,
  Card,
  EmptyState,
  Field,
  LoadingState,
  PageHeader,
  Select,
} from "@/components/ui";

/**
 * The cargo sheet: what to load, in how many boxes of each size, for the ship
 * currently flown.
 *
 * Entirely offline. The only thing read from the site is the ship list, and
 * even that is cached — a haul is planned in flight, where the connection is
 * the least of the worries.
 */
export default function CargoPage() {
  const { sheet, loading } = useCargoSheet();
  const { transports, source, loading: loadingTransports } = useTransports();
  const [changingShip, setChangingShip] = useState(false);

  if (loading || loadingTransports || !transports) return <LoadingState />;

  const sourceWarning = TRANSPORT_SOURCE_LABELS[source];

  if (!sheet) {
    return (
      <>
        <PageHeader
          title="Feuille de cargo"
          description="Répartissez vos volumes en conteneurs SCU et suivez le remplissage du vaisseau."
        />

        <Card className="max-w-md p-6">
          <h2 className="mb-1 text-sm font-semibold text-nexus-bright">
            Aucune feuille en cours
          </h2>
          <p className="mb-4 text-xs text-nexus-accent/60">
            Choisissez le vaisseau que vous utilisez : c'est sa capacité qui
            décide du reste.
          </p>

          <ShipPicker
            transports={transports}
            submitLabel="Créer la feuille"
            onSubmit={(ship) => void startSheet(ship)}
          />

          {sourceWarning ? (
            <p className="mt-3 text-[11px] text-amber-300/80">
              {sourceWarning}
            </p>
          ) : null}
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Feuille de cargo"
        description="Hors ligne : cette feuille ne quitte pas cette machine."
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void invoke("toggle_cargo_overlay")}
            >
              <PanelRight className="h-3.5 w-3.5" />
              Superposition
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (sheet.lines.length > 0 && !confirmClose()) return;
                void closeSheet();
              }}
            >
              Clôturer
            </Button>
          </>
        }
      />

      {sourceWarning ? (
        <p className="mb-3 rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
          {sourceWarning}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-5">
            <CapacitySummary
              lines={sheet.lines}
              capacity={sheet.capacity}
              shipName={sheet.shipName}
            />
          </Card>

          {sheet.lines.length === 0 ? (
            <EmptyState
              title="Feuille vide"
              description="Ajoutez une ligne, collez un journal de mission, ou capturez-le à l'écran avec le raccourci de capture."
            />
          ) : (
            <MissionGroups
              lines={sheet.lines}
              missionPlaceholder={missionName(sheet.missionCounter)}
              onRemoveLine={(id) => void removeLine(id)}
              onRemoveMission={(mission) => void removeMission(mission)}
              onEditLine={(id, line) => void updateLine(id, line)}
            />
          )}
        </div>

        <div className="space-y-4">
          <AddLineCard currentMission={missionName(sheet.missionCounter)} />

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-nexus-bright">
              Réglages
            </h2>

            <div className="space-y-3">
              <Field label="Plus gros conteneur">
                <Select
                  value={String(sheet.maxContainer)}
                  onChange={(event) => {
                    const size = Number(event.target.value);
                    if (isContainerSize(size)) {
                      void setMaxContainer(size as ContainerSize);
                    }
                  }}
                >
                  {CONTAINER_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size} SCU
                    </option>
                  ))}
                </Select>
              </Field>

              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void startNewMission()}
              >
                Nouvelle mission
              </Button>

              {changingShip ? (
                <ShipPicker
                  transports={transports}
                  initialTransportId={sheet.transportId}
                  initialCapacity={sheet.capacity}
                  submitLabel="Changer de vaisseau"
                  onSubmit={(ship) => {
                    void setShip(ship);
                    setChangingShip(false);
                  }}
                />
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setChangingShip(true)}
                >
                  Changer de vaisseau
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function confirmClose(): boolean {
  return window.confirm(
    "Clôturer la feuille supprime toutes ses lignes. Continuer ?",
  );
}

/** Manual entry, and the paste that accepts a whole mission log at once. */
function AddLineCard({ currentMission }: { currentMission: string }) {
  const [paste, setPaste] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  function importPaste() {
    const result = parseQuickEntry(paste);

    if (result.parsed.length === 0) {
      setFeedback(
        "Rien de lisible : collez un journal de mission, ou des lignes « Destination;Contenu;Volume;Emplacement ».",
      );
      return;
    }

    void addLines(result.parsed);
    setPaste("");
    setFeedback(
      `${result.parsed.length} ligne${result.parsed.length > 1 ? "s" : ""} ajoutée${result.parsed.length > 1 ? "s" : ""}` +
        (result.invalid.length > 0
          ? ` · ${result.invalid.length} ignorée${result.invalid.length > 1 ? "s" : ""}`
          : ""),
    );
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-sm font-semibold text-nexus-bright">
        Ajouter du cargo
      </h2>
      <p className="mb-3 text-xs text-nexus-accent/50">
        Sans mission indiquée, la ligne rejoint « {currentMission} ».
      </p>

      <CargoLineForm
        submitLabel="Ajouter"
        submitIcon={<Plus className="h-3.5 w-3.5" />}
        onSubmit={(line) => {
          void addLines([line]);
          setFeedback(null);
        }}
      />

      <div className="mt-4 space-y-2 border-t border-nexus-accent/10 pt-4">
        <Field label="Coller un journal de mission">
          <textarea
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
            rows={4}
            spellCheck={false}
            placeholder={"Deliver 0/32 SCU of Titanium to Port Olisar above Crusader.\nCollect Titanium from Area18."}
            className="w-full rounded-lg border border-nexus-accent/20 bg-nexus-abyss/60 px-3 py-2 font-mono text-xs text-nexus-bright placeholder:text-nexus-accent/35 focus:border-nexus-accent/50 focus:outline-none"
          />
        </Field>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={paste.trim() === ""}
          onClick={importPaste}
        >
          Importer
        </Button>

        {feedback ? (
          <p className="text-xs text-nexus-accent/70">{feedback}</p>
        ) : null}
      </div>
    </Card>
  );
}
