import { useState, type FormEvent, type ReactNode } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import {
  CONTAINER_SIZES,
  containerCount,
  groupByMission,
  LOW_CAPACITY_THRESHOLD,
  MAX_VOLUME,
  sumQuantities,
  totalVolume,
  type CargoLine,
  type ParsedBulkLine,
} from "@/lib/cargo";
import { Button, Field, Input } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Box counts as «32 × 2 · 16 × 1», sizes with none left out. */
export function formatQuantities(quantities: number[]): string {
  const parts = CONTAINER_SIZES.map((size, index) =>
    quantities[index] > 0 ? `${size} × ${quantities[index]}` : null,
  ).filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "—";
}

/**
 * What is loaded against what the ship takes. The number that matters in
 * flight is the one left, so it is the one shown large.
 */
export function CapacitySummary({
  lines,
  capacity,
  shipName,
  compact = false,
}: {
  lines: CargoLine[];
  capacity: number;
  shipName: string;
  compact?: boolean;
}) {
  const used = totalVolume(lines);
  const remaining = capacity - used;
  const ratio = capacity > 0 ? Math.min(1, used / capacity) : 0;
  const over = remaining < 0;
  const tight = !over && remaining < LOW_CAPACITY_THRESHOLD;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <p
          className={cn(
            "truncate font-medium text-nexus-bright",
            compact ? "text-xs" : "text-sm",
          )}
        >
          {shipName}
        </p>
        <p
          className={cn(
            "shrink-0 tabular-nums",
            compact ? "text-xs" : "text-sm",
            over
              ? "text-red-300"
              : tight
                ? "text-amber-300"
                : "text-nexus-accent/70",
          )}
        >
          {used} / {capacity} SCU
          <span className="ml-2 text-nexus-bright/85">
            {over ? `${-remaining} en trop` : `${remaining} libres`}
          </span>
        </p>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-nexus-accent/10">
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            over
              ? "bg-red-400/80"
              : tight
                ? "bg-amber-400/80"
                : "bg-nexus-accent/70",
          )}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>

      <p className="text-[11px] text-nexus-accent/50">
        {lines.length} ligne{lines.length > 1 ? "s" : ""} ·{" "}
        {containerCount(sumQuantities(lines))} conteneurs ·{" "}
        {formatQuantities(sumQuantities(lines))}
      </p>
    </div>
  );
}

const EMPTY_LINE: ParsedBulkLine = {
  destination: "",
  content: "",
  volume: 0,
  location: "",
  mission: "",
};

/**
 * The fields a cargo line is made of, used both to add one and to rewrite one.
 *
 * `compact` is the overlay: the same fields, tight enough to sit inside a row
 * of the sheet, with the labels moved into the placeholders.
 */
export function CargoLineForm({
  initial,
  compact = false,
  withMission = false,
  missionPlaceholder,
  submitLabel,
  submitIcon,
  onSubmit,
  onCancel,
}: {
  /** Line being rewritten. Absent means this is an entry form. */
  initial?: CargoLine;
  compact?: boolean;
  /** Lets the line be moved to another mission, which only editing needs. */
  withMission?: boolean;
  /** Mission a line that names none of its own joins. */
  missionPlaceholder?: string;
  submitLabel: string;
  submitIcon?: ReactNode;
  onSubmit: (line: ParsedBulkLine) => void;
  onCancel?: () => void;
}) {
  const start = initial ?? EMPTY_LINE;

  const [destination, setDestination] = useState(start.destination);
  const [content, setContent] = useState(start.content);
  const [volume, setVolume] = useState(initial ? String(initial.volume) : "");
  const [location, setLocation] = useState(start.location);
  const [mission, setMission] = useState(start.mission);

  const parsedVolume = Math.floor(Number(volume));
  const valid =
    destination.trim() !== "" &&
    Number.isFinite(parsedVolume) &&
    parsedVolume > 0 &&
    parsedVolume <= MAX_VOLUME;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;

    onSubmit({
      destination: destination.trim(),
      content: content.trim(),
      volume: parsedVolume,
      location: location.trim(),
      mission: mission.trim(),
    });

    // An entry form is used over and over; a form editing a line goes away.
    // The location is deliberately kept: cargo is picked up from the same
    // place several lines running.
    if (!initial) {
      setDestination("");
      setContent("");
      setVolume("");
    }
  }

  if (compact) {
    return (
      <form onSubmit={submit} className="space-y-1.5">
        <div className="grid grid-cols-2 gap-1.5">
          <CompactInput
            label="Destination"
            value={destination}
            onChange={setDestination}
            placeholder="Port Olisar"
            autoFocus
          />
          <CompactInput
            label="Contenu"
            value={content}
            onChange={setContent}
            placeholder="Titanium"
          />
          <CompactInput
            label="Volume en SCU"
            value={volume}
            onChange={setVolume}
            placeholder="32 SCU"
            inputMode="numeric"
          />
          <CompactInput
            label="Emplacement"
            value={location}
            onChange={setLocation}
            placeholder="Area18"
          />
          {withMission ? (
            <CompactInput
              label="Mission"
              value={mission}
              onChange={setMission}
              placeholder={missionPlaceholder ?? "Mission"}
              className="col-span-2"
            />
          ) : null}
        </div>

        <FormActions
          submitLabel={submitLabel}
          submitIcon={submitIcon}
          valid={valid}
          onCancel={onCancel}
        />
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Destination">
        <Input
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          placeholder="Port Olisar"
        />
      </Field>

      <Field label="Contenu">
        <Input
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Titanium"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Volume (SCU)">
          <Input
            value={volume}
            inputMode="numeric"
            onChange={(event) => setVolume(event.target.value)}
            placeholder="32"
          />
        </Field>

        <Field label="Emplacement">
          <Input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Area18"
          />
        </Field>
      </div>

      {withMission ? (
        <Field label="Mission">
          <Input
            value={mission}
            onChange={(event) => setMission(event.target.value)}
            placeholder={missionPlaceholder ?? "Mission"}
          />
        </Field>
      ) : null}

      <FormActions
        submitLabel={submitLabel}
        submitIcon={submitIcon}
        valid={valid}
        onCancel={onCancel}
      />
    </form>
  );
}

function FormActions({
  submitLabel,
  submitIcon,
  valid,
  onCancel,
}: {
  submitLabel: string;
  submitIcon?: ReactNode;
  valid: boolean;
  onCancel?: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button type="submit" size="sm" disabled={!valid}>
        {submitIcon}
        {submitLabel}
      </Button>

      {onCancel ? (
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      ) : null}
    </div>
  );
}

/** Label in the placeholder, kept for screen readers — the overlay is narrow. */
function CompactInput({
  label,
  value,
  onChange,
  className,
  ...props
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  inputMode?: "numeric";
  autoFocus?: boolean;
}) {
  return (
    <input
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "w-full rounded border border-nexus-accent/20 bg-nexus-abyss/60 px-2 py-1 text-xs text-nexus-bright",
        "placeholder:text-nexus-accent/35 focus:border-nexus-accent/50 focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The sheet itself, one block per mission. `compact` is the overlay: same
 * data, read at a glance over the game.
 *
 * Every control is optional and drawn only when its handler is given, so the
 * same component is the read-only manifest and the editable one.
 */
export function MissionGroups({
  lines,
  compact = false,
  missionPlaceholder,
  onRemoveLine,
  onRemoveMission,
  onEditLine,
}: {
  lines: CargoLine[];
  compact?: boolean;
  missionPlaceholder?: string;
  onRemoveLine?: (id: string) => void;
  onRemoveMission?: (mission: string) => void;
  onEditLine?: (id: string, line: ParsedBulkLine) => void;
}) {
  const groups = groupByMission(lines);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {groups.map((group) => (
        <div
          key={group.mission || "__unassigned__"}
          className="overflow-hidden rounded-lg border border-nexus-accent/15 bg-nexus-abyss/40"
        >
          <div className="flex items-center justify-between gap-2 border-b border-nexus-accent/10 px-3 py-1.5">
            <p className="truncate text-xs font-medium text-nexus-bright/90">
              {group.mission || "Sans mission"}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[11px] tabular-nums text-nexus-accent/60">
                {group.volume} SCU · {formatQuantities(group.quantities)}
              </span>
              {onRemoveMission && group.mission ? (
                <IconButton
                  label="Supprimer la mission"
                  danger
                  onClick={() => onRemoveMission(group.mission)}
                >
                  <Trash2 className="size-3" />
                </IconButton>
              ) : null}
            </div>
          </div>

          <ul className="divide-y divide-nexus-accent/10">
            {group.lines.map((line) => (
              <li key={line.id} className="px-3 py-1.5 text-xs">
                {onEditLine && editing === line.id ? (
                  <div className="py-1">
                    <CargoLineForm
                      initial={line}
                      compact={compact}
                      withMission
                      missionPlaceholder={missionPlaceholder}
                      submitLabel="Enregistrer"
                      submitIcon={<Check className="h-3.5 w-3.5" />}
                      onSubmit={(edit) => {
                        onEditLine(line.id, edit);
                        setEditing(null);
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-nexus-bright/90">
                        {line.destination}
                        {line.content ? (
                          <span className="text-nexus-accent/60">
                            {" "}
                            — {line.content}
                          </span>
                        ) : null}
                      </p>

                      {/* Narrow, the box counts go under the line rather than
                          beside it: they are what is read while loading, so
                          they are the last thing that should be dropped. */}
                      <div className="flex items-baseline gap-2 text-[11px] text-nexus-accent/50">
                        {line.location ? (
                          <span className="truncate">
                            Depuis {line.location}
                          </span>
                        ) : null}
                        {compact ? (
                          <span className="ml-auto shrink-0 tabular-nums">
                            {formatQuantities(line.quantities)}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <span className="shrink-0 tabular-nums text-nexus-accent/70">
                      {line.volume} SCU
                    </span>

                    {!compact ? (
                      <span className="shrink-0 tabular-nums text-nexus-accent/50">
                        {formatQuantities(line.quantities)}
                      </span>
                    ) : null}

                    {onEditLine ? (
                      <IconButton
                        label="Modifier la ligne"
                        onClick={() => setEditing(line.id)}
                      >
                        <Pencil className="size-3" />
                      </IconButton>
                    ) : null}

                    {onRemoveLine ? (
                      <IconButton
                        label="Supprimer la ligne"
                        danger
                        onClick={() => onRemoveLine(line.id)}
                      >
                        <Trash2 className="size-3" />
                      </IconButton>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function IconButton({
  label,
  danger = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded p-1 text-nexus-accent/40 transition hover:bg-white/5",
        danger ? "hover:text-red-300" : "hover:text-nexus-bright",
      )}
    >
      <span className="sr-only">{label}</span>
      {children}
    </button>
  );
}

/** The close button of the sheet, which asks twice rather than once. */
export function CloseSheetButton({
  lineCount,
  onConfirm,
}: {
  lineCount: number;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <Button
        type="button"
        size="sm"
        variant="danger"
        onClick={() => (lineCount > 0 ? setAsking(true) : onConfirm())}
      >
        Clôturer
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="danger"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        <Check className="h-3.5 w-3.5" />
        {lineCount} ligne{lineCount > 1 ? "s" : ""} — confirmer
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setAsking(false)}
      >
        <X className="h-3.5 w-3.5" />
        <span className="sr-only">Annuler</span>
      </Button>
    </div>
  );
}
