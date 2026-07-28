import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTransparentWindow } from "@/hooks/use-transparent-window";

type Point = { x: number; y: number };

/** Below this many pixels a drag is treated as a stray click, not a selection. */
const MIN_DRAG_PX = 8;

/**
 * Fullscreen selection layer for region capture.
 *
 * The screen pixels were already frozen by Rust before this window was shown,
 * so nothing here ends up in the OCR input. The rectangle is reported as
 * fractions of the window, which keeps DPI scaling out of the protocol.
 */
export default function CapturePage() {
  const [origin, setOrigin] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [busy, setBusy] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);

  useTransparentWindow();

  // A fresh capture reuses the same window, so stale state must not survive.
  useEffect(() => {
    const reset = () => {
      setOrigin(null);
      setCursor(null);
      setBusy(false);
      surfaceRef.current?.focus();
    };
    reset();
    window.addEventListener("focus", reset);
    return () => window.removeEventListener("focus", reset);
  }, []);

  function cancel() {
    setOrigin(null);
    setCursor(null);
    void invoke("cancel_capture");
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (busy || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    setOrigin(point);
    setCursor(point);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!origin || busy) return;
    setCursor({ x: event.clientX, y: event.clientY });
  }

  async function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!origin || busy) return;
    event.currentTarget.releasePointerCapture(event.pointerId);

    const end = { x: event.clientX, y: event.clientY };
    const left = Math.min(origin.x, end.x);
    const top = Math.min(origin.y, end.y);
    const width = Math.abs(end.x - origin.x);
    const height = Math.abs(end.y - origin.y);

    setOrigin(null);
    setCursor(null);

    if (width < MIN_DRAG_PX || height < MIN_DRAG_PX) {
      cancel();
      return;
    }

    setBusy(true);
    try {
      await invoke("recognize_selection", {
        selection: {
          x: left / window.innerWidth,
          y: top / window.innerHeight,
          width: width / window.innerWidth,
          height: height / window.innerHeight,
        },
      });
    } catch (error) {
      // Rust has already hidden this window and opened the overlay, so there
      // is nowhere left to show this.
      console.error("OCR failed", error);
    } finally {
      setBusy(false);
    }
  }

  const box =
    origin && cursor
      ? {
          left: Math.min(origin.x, cursor.x),
          top: Math.min(origin.y, cursor.y),
          width: Math.abs(cursor.x - origin.x),
          height: Math.abs(cursor.y - origin.y),
        }
      : null;

  return (
    <div
      ref={surfaceRef}
      tabIndex={-1}
      className="relative h-screen w-screen cursor-crosshair overflow-hidden outline-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={(event) => {
        if (event.key === "Escape") cancel();
      }}
    >
      {/* Dims the screen only while nothing is selected; once a box exists the
          shadow below takes over so the selected area stays legible. */}
      {!box && <div className="absolute inset-0 bg-black/25" />}

      {box && (
        <div
          className="absolute border-2 border-sky-400"
          style={{
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            // Dims everything outside the selection in one paint.
            boxShadow: "0 0 0 100vmax rgba(0, 0, 0, 0.45)",
          }}
        />
      )}

      {!box && !busy && (
        <p className="pointer-events-none absolute inset-x-0 top-10 text-center text-sm text-white/80 drop-shadow">
          Tracez une zone pour en lire le texte · Échap pour annuler
        </p>
      )}

      {busy && (
        <p className="pointer-events-none absolute inset-x-0 top-10 text-center text-sm text-white/80 drop-shadow">
          Lecture du texte…
        </p>
      )}
    </div>
  );
}
