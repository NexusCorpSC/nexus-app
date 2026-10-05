import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/** Where each history entry was left, by location key. */
const positions = new Map<string, number>();

/** How long a list may take to show its results before giving up. */
const RESTORE_TIMEOUT_MS = 1500;

/**
 * Scroll memory for the screen area: a new screen opens at the top, and
 * going back finds the previous one where it was left. The router's own
 * restoration only knows the window, and the app scrolls `main`.
 *
 * A filter change rewrites the address in place (a new location key): the
 * position follows it, so the list is found where it was when coming back.
 */
export function useScrollRestoration(ref: RefObject<HTMLElement | null>) {
  const location = useLocation();
  const action = useNavigationType();
  const lastTop = useRef(0);
  const lastKey = useRef(location.key);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onScroll = () => {
      lastTop.current = element.scrollTop;
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [ref]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || lastKey.current === location.key) return;

    // Read from the scroll events, not the element: the new screen is
    // already in place and may have clamped it.
    positions.set(lastKey.current, lastTop.current);
    lastKey.current = location.key;

    if (action === "REPLACE") return;

    const target = action === "POP" ? (positions.get(location.key) ?? 0) : 0;
    element.scrollTop = target;
    lastTop.current = element.scrollTop;
    if (element.scrollTop >= target) return;

    // The list may still be loading: wait for it to grow tall enough.
    const started = performance.now();
    let frame = requestAnimationFrame(function retry() {
      element.scrollTop = target;
      lastTop.current = element.scrollTop;
      if (
        element.scrollTop < target &&
        performance.now() - started < RESTORE_TIMEOUT_MS
      ) {
        frame = requestAnimationFrame(retry);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [ref, location.key, action]);
}
