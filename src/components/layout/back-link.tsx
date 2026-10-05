import type { MouseEvent, ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "use-intl";
import { lastListUrl, previousPath } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useNavigationTracker } from "@/hooks/use-navigation-tracker";

/**
 * The "back" link at the top of a screen. It returns to the screen the reader
 * actually came from, and only falls back to `to` (the list as last left,
 * filters included) when the app opened straight on this screen.
 *
 * The label names the list when that is where it leads, and says "Retour"
 * when the previous screen is something else.
 */
export function BackLink({
  to,
  children,
  className,
}: {
  /** The list this screen belongs to, e.g. `/items`. */
  to: string;
  /** What to call that list, e.g. "Retour aux objets". */
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations("Common");
  useNavigationTracker();
  const navigate = useNavigate();
  const previous = previousPath();
  const target = previous ?? lastListUrl(to);
  const leadsToList = target.split("?")[0] === to;

  function goBack(event: MouseEvent<HTMLAnchorElement>) {
    if (previous === null) return;
    event.preventDefault();
    navigate(-1);
  }

  return (
    <Link
      to={target}
      onClick={goBack}
      className={cn(
        "mb-4 inline-flex items-center gap-1.5 text-xs text-nexus-dim transition-colors hover:text-nexus-accent",
        className,
      )}
    >
      <ArrowLeft className="size-3.5" />
      {leadsToList ? children : t("back")}
    </Link>
  );
}
