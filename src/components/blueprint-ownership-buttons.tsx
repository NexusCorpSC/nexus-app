import { Check, Loader2, Minus, Plus, TriangleAlert } from "lucide-react";
import type { UseMutationResult } from "@tanstack/react-query";
import { useTranslations } from "use-intl";
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

type Translate = ReturnType<typeof useTranslations<"Blueprints.ownership">>;

/** What a button has to say, once it has said it. */
function outcome(t: Translate, mutation: Mutation, verb: "add" | "remove") {
  const data = mutation.data;
  if (!data) return null;

  if (verb === "add") {
    return data.changed
      ? { label: t("added"), title: t("addedTitle") }
      : { label: t("alreadyIn"), title: t("alreadyInTitle") };
  }

  return data.changed
    ? { label: t("removed"), title: t("removedTitle") }
    : { label: t("alreadyOut"), title: t("alreadyOutTitle") };
}

function errorText(t: Translate, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return t("failed", { message });
}

/** Labelled, for a page header. */
export function BlueprintAddButton({ blueprintId }: { blueprintId: string }) {
  const t = useTranslations("Blueprints.ownership");
  const add = useAddBlueprint();
  const done = outcome(t, add, "add");

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
      title={add.isError ? errorText(t, add.error) : t("add")}
      onClick={() => add.mutate(blueprintId)}
    >
      {add.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : add.isError ? (
        <TriangleAlert className="h-3.5 w-3.5" />
      ) : (
        <Plus className="h-3.5 w-3.5" />
      )}
      {add.isError ? t("retry") : t("add")}
    </Button>
  );
}

/** The other way round. Only offered on a blueprint the user actually added. */
export function BlueprintRemoveButton({
  blueprintId,
}: {
  blueprintId: string;
}) {
  const t = useTranslations("Blueprints.ownership");
  const remove = useRemoveBlueprint();
  const done = outcome(t, remove, "remove");

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
      variant="outline"
      size="sm"
      disabled={remove.isPending}
      title={
        remove.isError ? errorText(t, remove.error) : t("remove")
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
      {remove.isError ? t("retry") : t("remove")}
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
  const t = useTranslations("Blueprints.ownership");
  const add = useAddBlueprint();
  const done = outcome(t, add, "add");

  return (
    <QuickButton
      title={done ? done.title : t("add")}
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
  const t = useTranslations("Blueprints.ownership");
  const remove = useRemoveBlueprint();
  const done = outcome(t, remove, "remove");

  return (
    <QuickButton
      title={done ? done.title : t("ownedRemove")}
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
  const t = useTranslations("Blueprints.ownership");
  const label = mutation.isError ? errorText(t, mutation.error) : title;

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
