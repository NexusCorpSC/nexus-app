import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useTransparentWindow } from "@/hooks/use-transparent-window";
import {
  DEFAULT_NOTIFICATION_CORNER,
  MAX_VISIBLE_NOTIFICATIONS,
  NOTIFICATION_CORNER_EVENT,
  NOTIFICATION_EVENT,
  NOTIFICATION_WIDTH,
  notificationTimeout,
  type AppNotification,
  type NotificationCorner,
  type NotificationKind,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";

/** However long it is hovered, a toast is gone after this. */
const MAX_LIFETIME_MS = 30_000;

const ICONS: Record<NotificationKind, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

type Tone = { border: string; icon: string; bar: string };

const TONES: Record<NotificationKind, Tone> = {
  info: {
    border: "border-sky-400/30",
    icon: "text-sky-300",
    bar: "bg-sky-400/70",
  },
  success: {
    border: "border-emerald-400/30",
    icon: "text-emerald-300",
    bar: "bg-emerald-400/70",
  },
  warning: {
    border: "border-amber-400/30",
    icon: "text-amber-300",
    bar: "bg-amber-400/70",
  },
  error: {
    border: "border-red-400/30",
    icon: "text-red-300",
    bar: "bg-red-400/70",
  },
};

/**
 * The stack of toasts, in a window Rust keeps pinned to a corner of the screen.
 *
 * Nothing is raised from here: notifications come in as events, whoever sent
 * them, so they show up whether the app is in the foreground, minimised or
 * behind a game.
 */
export default function NotificationsOverlayPage() {
  useTransparentWindow();

  const [items, setItems] = useState<AppNotification[]>([]);
  const [corner, setCorner] = useState<NotificationCorner>(
    DEFAULT_NOTIFICATION_CORNER,
  );
  const stackRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  // Listening is set up before Rust is told this window is ready, because that
  // very call hands over whatever was raised while the bundle was loading.
  useEffect(() => {
    const pending = Promise.all([
      listen<AppNotification>(NOTIFICATION_EVENT, (event) => {
        setItems((current) =>
          [...current, event.payload].slice(-MAX_VISIBLE_NOTIFICATIONS),
        );
      }),
      listen<NotificationCorner>(NOTIFICATION_CORNER_EVENT, (event) => {
        setCorner(event.payload);
      }),
    ]);

    void pending
      .then(() => invoke<NotificationCorner>("notifications_ready"))
      .then(setCorner)
      .catch((error) => {
        console.error("cannot register the notification overlay", error);
      });

    return () => {
      void pending.then((unlisteners) => {
        for (const unlisten of unlisteners) unlisten();
      });
    };
  }, []);

  // The window is kept exactly as tall as the stack. Any surplus would swallow
  // clicks meant for whatever is underneath — usually the game.
  useEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;

    if (items.length === 0) {
      void invoke("hide_notifications").catch((error) => {
        console.error("cannot hide the notification overlay", error);
      });
      return;
    }

    const report = () => {
      const { height } = stack.getBoundingClientRect();
      if (height <= 0) return;

      void invoke("resize_notifications", {
        width: NOTIFICATION_WIDTH,
        height: Math.ceil(height),
      }).catch((error) => {
        console.error("cannot place the notification overlay", error);
      });
    };

    report();

    // A toast grows as its text wraps and the stack shrinks as toasts expire,
    // neither of which is visible from the item count alone.
    const observer = new ResizeObserver(report);
    observer.observe(stack);

    return () => observer.disconnect();
  }, [items]);

  const bottom = corner.startsWith("bottom");
  const right = corner.endsWith("right");

  return (
    <div
      className={cn(
        // Only the toasts take the mouse, so the gap between two of them is
        // not read as hovering either. The window itself is kept tight around
        // the stack by Rust — that is what keeps the rest of the screen free.
        "pointer-events-none flex h-screen w-screen overflow-hidden",
        bottom ? "items-end" : "items-start",
        right ? "justify-end" : "justify-start",
      )}
    >
      <div
        ref={stackRef}
        style={{ width: NOTIFICATION_WIDTH }}
        className={cn(
          // Newest nearest the corner the stack hangs from.
          "flex gap-2 p-2",
          bottom ? "flex-col" : "flex-col-reverse",
        )}
      >
        {items.map((item) => (
          <Toast
            key={item.id}
            notification={item}
            fromRight={right}
            onDismiss={dismiss}
          />
        ))}
      </div>
    </div>
  );
}

function Toast({
  notification,
  fromRight,
  onDismiss,
}: {
  notification: AppNotification;
  fromRight: boolean;
  onDismiss: (id: number) => void;
}) {
  const [paused, setPaused] = useState(false);
  const timeout = notificationTimeout(notification);
  const { id, kind, title, body } = notification;

  // Hovering holds a toast on screen; leaving restarts its countdown from the
  // top, which is what makes a long message readable at all.
  useEffect(() => {
    if (paused || timeout <= 0) return;

    const timer = setTimeout(() => onDismiss(id), timeout);
    return () => clearTimeout(timer);
  }, [id, onDismiss, paused, timeout]);

  // A cursor left sitting in that corner — which a game holding the mouse
  // makes entirely possible — must not pin a toast there for the session.
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), MAX_LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  const Icon = ICONS[kind];
  const tone = TONES[kind];

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      // Slides in from the edge of the screen it is hung on.
      style={{ "--toast-from": fromRight ? "1.5rem" : "-1.5rem" } as CSSProperties}
      className={cn(
        "nexus-toast pointer-events-auto overflow-hidden rounded-xl border",
        "bg-[#061E30]/95 shadow-2xl shadow-black/40 backdrop-blur-xl",
        tone.border,
      )}
    >
      <div className="flex items-start gap-2.5 p-3">
        <Icon className={cn("mt-0.5 size-4 shrink-0", tone.icon)} />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-100">{title}</p>
          {body ? (
            <p className="mt-0.5 whitespace-pre-line break-words text-xs text-slate-400">
              {body}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => onDismiss(id)}
          title="Fermer"
          className="rounded p-1 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
        >
          <span className="sr-only">Fermer</span>
          <X className="size-3.5" />
        </button>
      </div>

      {timeout > 0 ? (
        <div className="h-0.5 bg-white/5">
          <div
            className={cn("nexus-toast-countdown h-full origin-left", tone.bar)}
            style={{
              animationDuration: `${timeout}ms`,
              animationPlayState: paused ? "paused" : "running",
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
