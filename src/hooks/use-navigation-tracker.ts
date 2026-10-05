import { useLocation, useNavigationType } from "react-router-dom";
import { recordNavigation } from "@/lib/navigation";

/**
 * Feeds the current location to the history tracker. It runs while
 * rendering, not in an effect, so a screen asking for the previous one during
 * its own render already gets the right answer.
 */
export function useNavigationTracker() {
  const location = useLocation();
  const action = useNavigationType();
  recordNavigation(
    action,
    location.key,
    `${location.pathname}${location.search}`,
  );
}
