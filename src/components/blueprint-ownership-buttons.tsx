import { Check, Loader2, Minus, Plus, TriangleAlert } from "lucide-react";
import type { UseMutationResult } from "@tanstack/react-query";
import {
  useAddBlueprint,
  useRemoveBlueprint,
} from "@/hooks/use-blueprint-ownership";
import type { BlueprintOwnership } from "@/lib/api/blueprints";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Putting a blueprint in «mes blueprints» and taking it back out, wherever one
 * is shown.
 *
 * Both calls report whether they changed anything, which is what lets the
 * **add** be offered where possession is unknown — the search palette, whose
 * results carry none: a click on an already-owned blueprint is answered «it was
 * already there» rather than going wrong.
 *
 * The **remove** is deliberately not offered there, and should not be. The
 * asymmetry is not in the routes but in the mistake: an add made in the dark
 * costs nothing, a remove made in the dark takes away a blueprint the user
 * meant to keep. Hence `BlueprintQuickRemove` only where `owned` is known.
 */

type Mutation = UseMutationResult<BlueprintOwnership, Error, string>;

/** What a button has to say, once it has said it. */
function outcome(mutation: Mutation, verb: "add" | "remove") {
  const data = mutation.data;
  if (!data) return null;

  if (verb === "add") {
    return data.changed
      ? { label: "Ajouté", title: "Ajouté à vos blueprints" }
      : { label: "Déjà dedans", title: "Déjà dans vos blueprints" };
  }

  return data.changed
    ? { label: "Retiré", title: "Retiré de vos blueprints" }
    : { label: "Déjà retiré", title: "N'était pas dans vos blueprints" };
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Impossible — ${message}`;
}

/** Labelled, for a page header. */
export function BlueprintAddButton({ blueprintId }: { blueprintId: string }) {
  const add = useAddBlueprint();
  const done = outcome(add, "add");

  if (done) {
    return (
      <Button variant="ghost" size="sm" disabled title={done.title}>
        <Check className="h-3.5 w-3.5" />
        {done.label}
      </Button>
    );
  }

  return (
    <Button
      variant="primary"
      size="sm"
      disabled={add.isPending}
      title={add.isError ? errorText(add.error) : "Ajouter à mes blueprints"}
      onClick={() => add.mutate(blueprintId)}
    >
      {add.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : add.isError ? (
        <TriangleAlert className="h-3.5 w-3.5" />
      ) : (
        <Plus className="h-3.5 w-3.5" />
      )}
      {add.isError ? "Réessayer" : "Ajouter à mes blueprints"}
    </Button>
  );
}

/** The other way round. Only offered on a blueprint the user actually added. */
export function BlueprintRemoveButton({
  blueprintId,
}: {
  blueprintId: string;
}) {
  const remove = useRemoveBlueprint();
  const done = outcome(remove, "remove");

  if (done) {
    return (
      <Button variant="ghost" size="sm" disabled title={done.title}>
        <Check className="h-3.5 w-3.5" />
        {done.label}
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={remove.isPending}
      title={
        remove.isError ? errorText(remove.error) : "Retirer de mes blueprints"
      }
      onClick={() => remove.mutate(blueprintId)}
    >
      {remove.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : remove.isError ? (
        <TriangleAlert className="h-3.5 w-3.5" />
      ) : (
        <Minus className="h-3.5 w-3.5" />
      )}
      {remove.isError ? "Réessayer" : "Retirer de mes blueprints"}
    </Button>
  );
}

/**
 * Icon only, for a list row. `tone` follows the surface: the palette is its
 * own window and does not use the application's palette.
 */
export function BlueprintQuickAdd({
  blueprintId,
  tone = "app",
  className,
}: {
  blueprintId: string;
  tone?: "app" | "overlay";
  className?: string;
}) {
  const add = useAddBlueprint();
  const done = outcome(add, "add");

  return (
    <QuickButton
      title={done ? done.title : "Ajouter à mes blueprints"}
      mutation={add}
      done={Boolean(done)}
      idle={<Plus className="size-4" />}
      className={cn(
        tone === "overlay"
          ? "text-slate-400 hover:bg-white/10 hover:text-slate-100"
          : "text-nexus-accent/50 hover:bg-nexus-accent/10 hover:text-nexus-accent",
        className,
      )}
      onClick={() => add.mutate(blueprintId)}
    />
  );
}

/**
 * The corner of an owned card: says so, and takes it back on a click. One
 * control rather than a badge beside a button — the card has room for one.
 */
export function BlueprintQuickRemove({
  blueprintId,
  className,
}: {
  blueprintId: string;
  className?: string;
}) {
  const remove = useRemoveBlueprint();
  const done = outcome(remove, "remove");

  return (
    <QuickButton
      title={done ? done.title : "Possédé — retirer de mes blueprints"}
      mutation={remove}
      done={Boolean(done)}
      idle={
        <>
          <Check className="size-4 group-hover:hidden" />
          <Minus className="hidden size-4 group-hover:block" />
        </>
      }
      className={cn(
        "group text-emerald-300/80 hover:bg-red-500/10 hover:text-red-300",
        className,
      )}
      onClick={() => remove.mutate(blueprintId)}
    />
  );
}

function QuickButton({
  title,
  mutation,
  done,
  idle,
  className,
  onClick,
}: {
  title: string;
  mutation: Mutation;
  done: boolean;
  idle: React.ReactNode;
  className?: string;
  onClick: () => void;
}) {
  const label = mutation.isError ? errorText(mutation.error) : title;

  return (
    <button
      type="button"
      title={label}
      disabled={mutation.isPending || done}
      onClick={(event) => {
        // The row underneath opens the blueprint; this button does not.
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "shrink-0 rounded-lg p-1.5 transition disabled:cursor-default",
        className,
        done ? "text-emerald-300 hover:bg-transparent" : null,
        mutation.isError ? "text-amber-300" : null,
      )}
    >
      <span className="sr-only">{label}</span>
      {mutation.isPending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : done ? (
        <Check className="size-4" />
      ) : mutation.isError ? (
        <TriangleAlert className="size-4" />
      ) : (
        idle
      )}
    </button>
  );
}
