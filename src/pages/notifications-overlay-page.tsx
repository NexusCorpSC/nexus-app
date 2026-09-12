import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useTransparentWindow } from "@/hooks/use-transparent-window";
import { openMainRoute } from "@/lib/main-window";
import {
  BANNER_WIDTH,
  DEFAULT_NOTIFICATION_CORNER,
  MAX_VISIBLE_BANNERS,
  MAX_VISIBLE_NOTIFICATIONS,
  NOTIFICATION_CORNER_EVENT,
  NOTIFICATION_EVENT,
  NOTIFICATION_WIDTH,
  notificationTimeout,
  type AppNotification,
  type NotificationCorner,
  type NotificationKind,
  type NotificationPlacement,
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
 * A stack of toasts, in a window Rust keeps pinned to its place on the screen:
 * a corner, or the top, centred — one window each, this page in both. Rust
 * tells the two apart by the window that calls it, so the page only has to
 * know how to look.
 *
 * Nothing is raised from here: notifications come in as events, whoever sent
 * them, so they show up whether the app is in the foreground, minimised or
 * behind a game.
 */
export default function NotificationsOverlayPage({
  placement,
}: {
  placement: NotificationPlacement;
}) {
  useTransparentWindow();

  const top = placement === "top";
  const width = top ? BANNER_WIDTH : NOTIFICATION_WIDTH;
  const capacity = top ? MAX_VISIBLE_BANNERS : MAX_VISIBLE_NOTIFICATIONS;

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
  //
  // Each listener is collected as it comes back rather than awaited as a
  // batch: one of them failing must not strand the one that succeeded, and one
  // coming back after the window went away must not outlive it.
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let gone = false;

    const keep = (unlisten: UnlistenFn) => {
      if (gone) unlisten();
      else unlisteners.push(unlisten);
    };

    const register = async () => {
      keep(
        await listen<AppNotification>(NOTIFICATION_EVENT, (event) => {
          setItems((current) => [...current, event.payload].slice(-capacity));
        }),
      );

      keep(
        await listen<NotificationCorner>(NOTIFICATION_CORNER_EVENT, (event) => {
          setCorner(event.payload);
        }),
      );

      setCorner(await invoke<NotificationCorner>("notifications_ready"));
    };

    void register().catch((error) => {
      console.error("cannot register the notification overlay", error);
    });

    return () => {
      gone = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [capacity]);

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
        width,
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
  }, [items, width]);

  // At the top, the stack hangs from the top edge, centred, and slides down
  // from it; in a corner, it hangs from that corner and slides in from the
  // side of the screen it is on.
  const bottom = !top && corner.startsWith("bottom");
  const right = !top && corner.endsWith("right");
  const from = top
    ? { x: "0", y: "-1.5rem" }
    : { x: right ? "1.5rem" : "-1.5rem", y: "0" };

  return (
    <div
      className={cn(
        // Only the toasts take the mouse, so the gap between two of them is
        // not read as hovering either. The window itself is kept tight around
        // the stack by Rust — that is what keeps the rest of the screen free.
        "pointer-events-none flex h-screen w-screen overflow-hidden",
        bottom ? "items-end" : "items-start",
        top ? "justify-center" : right ? "justify-end" : "justify-start",
      )}
    >
      <div
        ref={stackRef}
        style={{ width }}
        className={cn(
          // Newest nearest the edge the stack hangs from.
          "flex gap-2 p-2",
          bottom ? "flex-col" : "flex-col-reverse",
        )}
      >
        {items.map((item) => (
          <Toast
            key={item.id}
            notification={item}
            large={top}
            from={from}
            onDismiss={dismiss}
          />
        ))}
      </div>
    </div>
  );
}

function Toast({
  notification,
  large,
  from,
  onDismiss,
}: {
  notification: AppNotification;
  /** Read from across the room: bigger type, more air, a bigger button. */
  large: boolean;
  /** Where the toast slides in from, as CSS lengths. */
  from: { x: string; y: string };
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
  const { route, action } = notification;

  // The button's whole job is to say something to the window that asked:
  // this one has no session and no network, that one has both and listens.
  // Dismissed once the event is out, and only then: a button whose press
  // went nowhere has to stay pressable.
  const perform = () => {
    if (!action) return;

    void emit(action.event, action.payload ?? null)
      .then(() => onDismiss(id))
      .catch((error) => {
        console.error("cannot answer the notification", error);
      });
  };

  // A toast with a route is the only way in while the app is behind the game,
  // so acting on it dismisses it: the main window now carries the subject.
  const act = () => {
    if (!route) return;

    void openMainRoute(route).catch((error) => {
      console.error("cannot open the main window", error);
    });

    onDismiss(id);
  };

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      // Slides in from the edge of the screen it is hung on.
      style={
        { "--toast-from-x": from.x, "--toast-from-y": from.y } as CSSProperties
      }
      className={cn(
        "nexus-toast pointer-events-auto overflow-hidden rounded-xl border",
        "bg-[#061E30]/95 shadow-2xl shadow-black/40 backdrop-blur-xl",
        tone.border,
      )}
    >
      <div
        className={cn(
          "flex items-start",
          large ? "gap-3.5 p-4" : "gap-2.5 p-3",
        )}
      >
        <Icon
          className={cn(
            "shrink-0",
            large ? "mt-0.5 size-6" : "mt-0.5 size-4",
            tone.icon,
          )}
        />

        {/* A button only when there is somewhere to go: a message that does
            nothing when clicked should not look like it would. */}
        <div className="min-w-0 flex-1">
          {route ? (
            <button
              type="button"
              onClick={act}
              className="block w-full cursor-pointer text-left"
            >
              <Message title={title} body={body} large={large} />
            </button>
          ) : (
            <Message title={title} body={body} large={large} />
          )}

          {action ? (
            <button
              type="button"
              onClick={perform}
              className={cn(
                "inline-flex items-center rounded-md border font-medium transition",
                "border-white/15 bg-white/10 text-slate-100 hover:bg-white/20",
                large ? "mt-3 px-4 py-1.5 text-sm" : "mt-2 px-2.5 py-1 text-xs",
              )}
            >
              {action.label}
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => onDismiss(id)}
          title="Fermer"
          className="rounded p-1 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
        >
          <span className="sr-only">Fermer</span>
          <X className={large ? "size-4" : "size-3.5"} />
        </button>
      </div>

      {timeout > 0 ? (
        <div className="nexus-toast-timer h-0.5 bg-white/5" aria-hidden>
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

function Message({
  title,
  body,
  large,
}: {
  title: string;
  body: string | null;
  large: boolean;
}) {
  return (
    <>
      <p
        className={cn(
          "text-slate-100",
          large ? "text-lg font-semibold" : "text-sm font-medium",
        )}
      >
        {title}
      </p>
      {body ? (
        <p
          className={cn(
            "whitespace-pre-line break-words",
            large
              ? "mt-1 text-base text-slate-300"
              : "mt-0.5 text-xs text-slate-400",
          )}
        >
          {body}
        </p>
      ) : null}
    </>
  );
}
