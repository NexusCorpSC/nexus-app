import {
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import {
  AlertTriangle,
  LayoutGrid,
  List,
  Loader2,
  Search,
  SearchX,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md";
};

const BUTTON_VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  // The one action a screen is for: solid, so it is found at a glance.
  primary:
    "bg-nexus-accent text-nexus-abyss border-nexus-accent font-semibold hover:bg-nexus-bright",
  outline:
    "bg-transparent text-nexus-bright border-nexus-accent/25 hover:border-nexus-accent/45 hover:bg-nexus-accent/8",
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
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nexus-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-9.5 px-4 text-[13px]",
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
  "w-full rounded-lg border border-nexus-accent/15 bg-nexus-card px-3 py-2 text-[13.5px] text-nexus-white " +
  "placeholder:text-nexus-dim/80 focus:border-nexus-accent/50 focus:outline-none";

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
      <span className="font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-nexus-muted">
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
        "rounded-xl border border-nexus-accent/12 bg-nexus-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A dialog over the screen: Escape and a click on the backdrop close it.
 * Rendered only while open, so its state starts afresh each time.
 */
export function Modal({
  open,
  title,
  description,
  icon,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  description?: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-nexus-accent/25 bg-nexus-deep shadow-2xl shadow-black/50"
      >
        <header className="flex items-start gap-3 px-5 pt-5">
          {icon ? (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-nexus-panel text-nexus-accent">
              {icon}
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="font-display text-lg font-semibold text-nexus-white"
            >
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className="mt-0.5 text-[13px] text-nexus-muted"
              >
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Fermer"
            onClick={onClose}
            className="inline-flex size-9 items-center justify-center rounded-lg text-nexus-muted hover:bg-nexus-panel hover:text-nexus-soft"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
        {footer ? (
          <footer className="flex flex-wrap items-center gap-2 border-t border-nexus-accent/12 bg-nexus-abyss/60 px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
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
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[28px] leading-tight font-bold text-nexus-white">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-nexus-muted">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/** A small uppercase heading that opens a section of a page. */
export function SectionTitle({
  children,
  aside,
  className,
}: {
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("mb-3 flex items-baseline justify-between gap-4", className)}
    >
      <h2 className="font-display text-sm font-semibold tracking-[0.12em] text-nexus-muted uppercase">
        {children}
      </h2>
      {aside ? <div className="text-xs text-nexus-dim">{aside}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toolbar                                                             */
/* ------------------------------------------------------------------ */

/** The row of filters above a list or a grid. */
export function Toolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-center gap-2.5", className)}>
      {children}
    </div>
  );
}

/** A search box: the icon inside the field, the label for screen readers. */
export function SearchField({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label
      className={cn(
        "flex h-9.5 min-w-56 flex-1 items-center gap-2 rounded-lg border border-nexus-accent/15 bg-nexus-card px-3",
        "focus-within:border-nexus-accent/50",
        className,
      )}
    >
      <Search className="size-4 shrink-0 text-nexus-dim" />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        className="min-w-0 flex-1 bg-transparent text-[13.5px] text-nexus-white placeholder:text-nexus-dim/80 focus:outline-none"
        {...props}
      />
    </label>
  );
}

/** A labelled select that sits in a toolbar, the label inside the box. */
export function ToolbarSelect({
  label,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label
      className={cn(
        "flex h-9.5 items-center gap-2 rounded-lg border border-nexus-accent/15 bg-nexus-card pl-3 pr-2 text-[13px] text-nexus-muted",
        className,
      )}
    >
      {label}
      <select
        className="max-w-56 bg-transparent text-nexus-white focus:outline-none [&>option]:bg-nexus-abyss"
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

/** A checkbox that sits in a toolbar, framed like the fields beside it. */
export function ToolbarToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex h-9.5 cursor-pointer items-center gap-2 rounded-lg border border-nexus-accent/15 bg-nexus-card px-3 text-[13px] text-nexus-bright">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-nexus-accent"
      />
      {label}
    </label>
  );
}

/** One pill of a row of filters: solid when chosen. */
export function Chip({
  active,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "h-7.5 shrink-0 rounded-full border px-3 text-[12.5px] transition-colors",
        active
          ? "border-nexus-accent bg-nexus-accent font-semibold text-nexus-abyss"
          : "border-nexus-accent/20 text-nexus-bright hover:border-nexus-accent/40",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Two to four mutually exclusive choices in one frame: a mode, a filter, a
 * view. Each option may carry an icon; icon-only options need a label.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: { value: T; label: string; icon?: ReactNode; iconOnly?: boolean }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex h-9.5 shrink-0 items-stretch rounded-lg border border-nexus-accent/15 bg-nexus-card p-[3px]",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={option.iconOnly ? option.label : undefined}
            title={option.iconOnly ? option.label : undefined}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition-colors",
              option.iconOnly && "px-2.5",
              active
                ? "bg-nexus-accent/16 text-nexus-white"
                : "text-nexus-muted hover:text-nexus-bright",
            )}
          >
            {option.icon}
            {option.iconOnly ? null : option.label}
          </button>
        );
      })}
    </div>
  );
}

export type ViewMode = "grid" | "list";

/** The grid / list switch of the pages that offer both. */
export function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
}) {
  return (
    <Segmented
      label="Affichage"
      value={value}
      onChange={onChange}
      options={[
        {
          value: "grid",
          label: "Grille",
          icon: <LayoutGrid className="size-4" />,
          iconOnly: true,
        },
        {
          value: "list",
          label: "Liste",
          icon: <List className="size-4" />,
          iconOnly: true,
        },
      ]}
    />
  );
}

/** A keyboard combination, as the settings write it. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[10.5px] text-nexus-dim">{children}</span>
  );
}
