import type { ReactNode } from "react";

/** The title that opens a rubrique, with its actions on the right. */
export function SettingsSectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="font-display text-xl leading-tight font-semibold text-nexus-white">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-[13px] text-nexus-muted">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/** The small uppercase heading at the top of a settings card. */
export function SettingsCardTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="border-b border-nexus-accent/8 px-4 py-3 font-display text-[11px] font-semibold tracking-[0.12em] text-nexus-muted uppercase">
      {children}
    </h3>
  );
}

/** A failure the user has to read: shown in place, never only logged. */
export function SettingsError({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200">
      {children}
    </p>
  );
}
