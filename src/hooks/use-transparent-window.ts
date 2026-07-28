import { useEffect } from "react";

/**
 * Clears the opaque background painted by the global stylesheet, for the
 * frameless transparent windows (overlay, capture).
 *
 * Both elements are restored on unmount: leaving either transparent would
 * follow the window if it ever rendered another route.
 */
export function useTransparentWindow() {
  useEffect(() => {
    const root = document.documentElement;
    const { body } = document;

    const previous = {
      root: root.style.background,
      body: body.style.background,
    };

    root.style.background = "transparent";
    body.style.background = "transparent";

    return () => {
      root.style.background = previous.root;
      body.style.background = previous.body;
    };
  }, []);
}
