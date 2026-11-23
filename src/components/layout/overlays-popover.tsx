import { useEffect, useRef, useState } from "react";
import { Layers } from "lucide-react";
import { useTranslations } from "use-intl";
import { DRAWER_OVERLAYS } from "@/components/layout/navigation";
import { formatShortcut, type Shortcuts } from "@/lib/settings";
import { cn } from "@/lib/utils";
import type { OverlayLabel } from "@/lib/windows";

/**
 * The «En jeu» rail trigger and its floating launcher for all in-game
 * overlays, always visible without scrolling.
 */
export function OverlaysPopover({
  shortcuts,
  onOpenOverlay,
}: {
  shortcuts: Shortcuts;
  onOpenOverlay: (label: OverlayLabel) => void;
}) {
  const t = useTranslations("Layout");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const radialShortcut = formatShortcut(shortcuts.radial).replace(/ \+ /g, "+");

  return (
    <div ref={root} className="relative flex justify-center">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        title={t("overlaysDrawer.title")}
        className={cn(
          "relative flex w-[60px] flex-col items-center gap-1 rounded-[10px] border px-1 py-2 transition-colors",
          open
            ? "border-nexus-accent/35 bg-nexus-accent/16 text-nexus-white"
            : "border-nexus-accent/20 bg-nexus-accent/8 text-nexus-accent hover:border-nexus-accent/35 hover:bg-nexus-accent/14 hover:text-nexus-white",
        )}
      >
        <Layers className="size-[17px]" />
        <span className="text-center text-[10.5px] leading-[1.1] font-medium">
          {t("rail.inGame")}
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={t("overlaysDrawer.title")}
          className="absolute bottom-0 left-full z-30 ml-2.5 flex w-80 flex-col gap-2.5 rounded-2xl border border-nexus-accent/22 bg-nexus-card p-3.5 shadow-2xl shadow-black/50"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-display text-[13px] font-bold tracking-[0.06em] text-nexus-white uppercase">
                {t("overlaysDrawer.title")}
              </p>
              <p className="mt-0.5 text-[11px] text-nexus-muted">
                {t("overlaysDrawer.subtitle")}
              </p>
            </div>
            <span className="shrink-0 rounded-md border border-nexus-accent/16 bg-nexus-accent/8 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-nexus-muted">
              {t("overlaysDrawer.radial", { shortcut: radialShortcut })}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {DRAWER_OVERLAYS.map(({ label, key, icon: Icon, shortcut }) => {
              const name = t(`overlays.${key}`);
              const kbd = formatShortcut(shortcuts[shortcut]).replace(
                / \+ /g,
                "+",
              );
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    onOpenOverlay(label);
                    setOpen(false);
                  }}
                  title={t("showOverlay", { name })}
                  className="flex items-center gap-2 rounded-lg border border-nexus-accent/12 bg-nexus-night/80 px-2.5 py-2 text-left transition-colors hover:border-nexus-accent/30 hover:bg-nexus-deep/90"
                >
                  <Icon className="size-4 shrink-0 text-nexus-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-nexus-white">
                      {name}
                    </span>
                    <span className="block truncate font-mono text-[9.5px] text-nexus-dim">
                      {kbd}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
