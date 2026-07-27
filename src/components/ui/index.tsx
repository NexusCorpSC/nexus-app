import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { AlertTriangle, Loader2, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md";
};

const BUTTON_VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-nexus-accent/15 text-nexus-accent border-nexus-accent/40 hover:bg-nexus-accent/25",
  ghost:
    "bg-transparent text-nexus-accent/80 border-transparent hover:bg-nexus-accent/10 hover:text-nexus-accent",
  danger:
    "bg-red-500/10 text-red-300 border-red-400/40 hover:bg-red-500/20",
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nexus-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-4 py-2 text-sm",
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

const FIELD_CLASSES =
  "w-full rounded-lg border border-nexus-accent/20 bg-nexus-abyss/60 px-3 py-2 text-sm text-nexus-bright " +
  "placeholder:text-nexus-accent/35 focus:border-nexus-accent/50 focus:outline-none";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD_CLASSES, className)} {...props} />;
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(FIELD_CLASSES, "pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-nexus-accent/60">
        {label}
      </span>
      {children}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-nexus-accent/15 bg-nexus-panel/50 shadow-lg shadow-black/20",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "warning" | "success";
}) {
  const tones = {
    default: "border-nexus-accent/25 bg-nexus-accent/10 text-nexus-accent",
    warning: "border-amber-400/30 bg-amber-400/10 text-amber-200",
    success: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      className={cn("h-4 w-4 animate-spin text-nexus-accent", className)}
    />
  );
}

export function LoadingState({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-nexus-accent/60">
      <Spinner />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <SearchX className="h-8 w-8 text-nexus-accent/30" />
      <p className="text-sm font-medium text-nexus-bright/80">{title}</p>
      {description ? (
        <p className="max-w-sm text-xs text-nexus-accent/50">{description}</p>
      ) : null}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const message =
    error instanceof Error ? error.message : "Une erreur est survenue.";

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <AlertTriangle className="h-8 w-8 text-amber-300/70" />
      <p className="max-w-md text-sm text-nexus-bright/80">{message}</p>
      {onRetry ? (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Réessayer
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-3 py-6">
      <Button
        variant="ghost"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Précédent
      </Button>
      <span className="text-xs text-nexus-accent/60">
        Page {page} / {totalPages}
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Suivant
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page header                                                         */
/* ------------------------------------------------------------------ */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-nexus-bright">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-nexus-accent/60">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}
