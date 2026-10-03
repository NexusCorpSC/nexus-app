import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The small tags of an event: visibility, the reader's registration, what is
 * missing, whether it is under way.
 */
export function EventPill({
  tone = "default",
  children,
}: {
  tone?: "default" | "registered" | "missing" | "live";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4",
        tone === "default" && "border-nexus-accent/25 text-nexus-bright",
        tone === "registered" &&
          "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
        tone === "missing" && "border-amber-300/40 text-amber-200",
        tone === "live" && "border-emerald-300/50 text-emerald-300",
      )}
    >
      {children}
    </span>
  );
}
