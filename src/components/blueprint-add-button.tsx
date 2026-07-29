import { Check, Loader2, Plus, TriangleAlert } from "lucide-react";
import { useAddBlueprint } from "@/hooks/use-add-blueprint";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Adding a blueprint to «mes blueprints», wherever one is shown.
 *
 * The route is idempotent and says which of the two happened, so the button
 * can be offered without knowing whether the blueprint is already owned —
 * which is exactly the search palette's case, where a result carries no
 * possession of its own.
 */

/** What the button has to say, once it has said it. */
function outcome(
  added: boolean | undefined,
): { label: string; title: string } | null {
  if (added === undefined) return null;

  return added
    ? { label: "Ajouté", title: "Ajouté à vos blueprints" }
    : { label: "Déjà dedans", title: "Déjà dans vos blueprints" };
}

/** Labelled, for a page header. */
export function BlueprintAddButton({ blueprintId }: { blueprintId: string }) {
  const add = useAddBlueprint();
  const done = outcome(add.data?.added);

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
  const done = outcome(add.data?.added);

  const base =
    tone === "overlay"
      ? "text-slate-400 hover:bg-white/10 hover:text-slate-100"
      : "text-nexus-accent/50 hover:bg-nexus-accent/10 hover:text-nexus-accent";

  const label = done
    ? done.title
    : add.isError
      ? errorText(add.error)
      : "Ajouter à mes blueprints";

  return (
    <button
      type="button"
      title={label}
      disabled={add.isPending || Boolean(done)}
      onClick={(event) => {
        // The row underneath opens the blueprint; this button does not.
        event.preventDefault();
        event.stopPropagation();
        add.mutate(blueprintId);
      }}
      className={cn(
        "shrink-0 rounded-lg p-1.5 transition disabled:cursor-default",
        base,
        done ? "text-emerald-300 hover:bg-transparent" : null,
        add.isError ? "text-amber-300" : null,
        className,
      )}
    >
      <span className="sr-only">{label}</span>
      {add.isPending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : done ? (
        <Check className="size-4" />
      ) : add.isError ? (
        <TriangleAlert className="size-4" />
      ) : (
        <Plus className="size-4" />
      )}
    </button>
  );
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Ajout impossible — ${message}`;
}
