//! Toasts shown in a corner of the screen.
//!
//! They live in their own always-on-top window rather than inside the main one:
//! this app spends most of its life minimised behind a game, and a notification
//! nobody can see is not a notification. The window is sized to whatever the
//! overlay is showing and moved to the chosen corner, so the rest of the screen
//! keeps taking clicks — the window covers the toasts and nothing else.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalRect, PhysicalSize};

use crate::diagnostics::log;
use crate::{window, NOTIFICATIONS_WINDOW};

/// Carries one notification to the overlay.
const SHOW_EVENT: &str = "notifications://show";

/// Tells the overlay which corner it hangs from, so the stack grows away from
/// the edge and the toasts slide in from the right side.
const CORNER_EVENT: &str = "notifications://corner";

/// Gap left between the toasts and the edges of the work area, in logical
/// pixels — the same unit the overlay measures itself in.
const MARGIN: f64 = 16.0;

/// How many notifications are held while the overlay is still loading.
const MAX_PENDING: usize = 8;

/// Which corner the toasts hang from.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    /// Where Windows shows its own notifications, so it is where users look.
    #[default]
    BottomRight,
}

impl Corner {
    fn is_right(self) -> bool {
        matches!(self, Corner::TopRight | Corner::BottomRight)
    }

    fn is_bottom(self) -> bool {
        matches!(self, Corner::BottomLeft | Corner::BottomRight)
    }
}

/// Severity, which the overlay turns into an icon, a colour and a duration.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    #[default]
    Info,
    Success,
    Warning,
    Error,
}

/// What a caller asks for.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationInput {
    #[serde(default)]
    kind: Kind,
    title: String,
    #[serde(default)]
    body: Option<String>,
    /// How long the toast stays up. Left to the overlay when absent, which
    /// gives errors longer than the rest.
    #[serde(default)]
    timeout_ms: Option<u64>,
    /// Route the main window opens when the toast is clicked. A notification
    /// with something to act on has to say where, since the window it would be
    /// acted on in is usually not on screen.
    #[serde(default)]
    route: Option<String>,
}

/// What the overlay receives.
///
/// The id is assigned here rather than by the caller so that notifications
/// raised from different windows — each one its own webview — cannot collide.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Notification {
    id: u64,
    kind: Kind,
    title: String,
    body: Option<String>,
    timeout_ms: Option<u64>,
    route: Option<String>,
}

/// The work area a visible stack is placed in.
///
/// Kept for as long as the stack is on screen: the monitor is chosen when the
/// first toast arrives, and one that jumped to another screen halfway through
/// its life would be harder to follow than one that stays where it appeared.
#[derive(Clone, Copy)]
struct Anchor {
    area: PhysicalRect<i32, u32>,
    scale: f64,
}

#[derive(Default)]
pub struct Notifications {
    corner: Mutex<Corner>,
    anchor: Mutex<Option<Anchor>>,
    /// Notifications raised before the overlay was listening.
    pending: Mutex<Vec<Notification>>,
    ready: AtomicBool,
    next_id: AtomicU64,
}

fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, String> {
    mutex
        .lock()
        .map_err(|_| "notification state is poisoned".to_string())
}

/// Raises a notification from Rust.
pub(crate) fn push(app: &AppHandle, kind: Kind, title: impl Into<String>, body: Option<String>) {
    deliver(
        app,
        NotificationInput {
            kind,
            title: title.into(),
            body,
            timeout_ms: None,
            route: None,
        },
    );
}

fn deliver(app: &AppHandle, input: NotificationInput) {
    let state = app.state::<Notifications>();

    let notification = Notification {
        id: state.next_id.fetch_add(1, Ordering::Relaxed),
        kind: input.kind,
        title: input.title,
        body: input.body,
        timeout_ms: input.timeout_ms,
        route: input.route,
    };

    // The overlay is created hidden at startup and loads the same bundle as
    // every other window, so a notification raised in the meantime would be
    // emitted to nobody. Held instead, and handed over when it says it is
    // listening.
    if !state.ready.load(Ordering::Acquire) {
        match lock(&state.pending) {
            Ok(mut pending) => {
                if pending.len() >= MAX_PENDING {
                    pending.remove(0);
                }
                pending.push(notification);
            }
            Err(error) => log(error),
        }

        return;
    }

    emit(app, &notification);
}

fn emit(app: &AppHandle, notification: &Notification) {
    if let Err(error) = app.emit_to(NOTIFICATIONS_WINDOW, SHOW_EVENT, notification) {
        log(format!(
            "notification `{}` was not delivered: {error}",
            notification.title
        ));
    }
}

/// Raises a notification from any window.
#[tauri::command]
pub fn notify(app: AppHandle, notification: NotificationInput) {
    deliver(&app, notification);
}

/// Called by the overlay once it is listening.
///
/// Answers with the corner it should hang from, and hands over whatever was
/// raised while it was still loading.
#[tauri::command]
pub fn notifications_ready(app: AppHandle) -> Result<Corner, String> {
    let state = app.state::<Notifications>();
    state.ready.store(true, Ordering::Release);

    let pending = std::mem::take(&mut *lock(&state.pending)?);
    for notification in &pending {
        emit(&app, notification);
    }

    // Read into a value of its own: a guard held to the end of the function
    // would outlive the state it borrows from.
    let corner = *lock(&state.corner)?;

    Ok(corner)
}

/// Sizes the window to the stack the overlay is showing, puts it in the chosen
/// corner and brings it up.
///
/// Called on every change to the stack: a window larger than its contents would
/// swallow clicks meant for whatever is underneath, which here is usually a
/// game.
#[tauri::command]
pub fn resize_notifications(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let anchor = anchor(&app)?;

    // A stack taller than the screen would push its oldest toasts off it.
    let ceiling = anchor
        .area
        .size
        .height
        .saturating_sub(to_physical(MARGIN * 2.0, anchor.scale));

    let size = PhysicalSize::new(
        to_physical(width, anchor.scale).max(1),
        to_physical(height, anchor.scale).clamp(1, ceiling.max(1)),
    );

    place(&app, &anchor, size)?;

    // Never focused: taking the foreground from a game to say something would
    // cost more than the notification is worth.
    window(&app, NOTIFICATIONS_WINDOW)?
        .show()
        .map_err(|e| e.to_string())
}

/// Called when the last toast is gone.
///
/// Drops the anchor as well, so the next stack picks the screen the user is on
/// then rather than the one they were on before.
#[tauri::command]
pub fn hide_notifications(app: AppHandle) -> Result<(), String> {
    *lock(&app.state::<Notifications>().anchor)? = None;

    window(&app, NOTIFICATIONS_WINDOW)?
        .hide()
        .map_err(|e| e.to_string())
}

/// Applies the corner chosen in Settings. Persisting it stays on the frontend,
/// which owns the store.
#[tauri::command]
pub fn set_notification_corner(app: AppHandle, corner: Corner) -> Result<(), String> {
    *lock(&app.state::<Notifications>().corner)? = corner;

    if let Err(error) = app.emit_to(NOTIFICATIONS_WINDOW, CORNER_EVENT, corner) {
        log(format!("notification corner was not announced: {error}"));
    }

    // A stack already on screen moves at once, which is what makes the choice
    // legible from Settings.
    let window = window(&app, NOTIFICATIONS_WINDOW)?;
    if window.is_visible().map_err(|e| e.to_string())? {
        let anchor = anchor(&app)?;
        let size = window.outer_size().map_err(|e| e.to_string())?;
        place(&app, &anchor, size)?;
    }

    Ok(())
}

fn place(app: &AppHandle, anchor: &Anchor, size: PhysicalSize<u32>) -> Result<(), String> {
    let corner = *lock(&app.state::<Notifications>().corner)?;
    let margin = to_physical(MARGIN, anchor.scale) as i32;
    let area = anchor.area;

    let x = if corner.is_right() {
        area.position.x + area.size.width as i32 - size.width as i32 - margin
    } else {
        area.position.x + margin
    };

    let y = if corner.is_bottom() {
        area.position.y + area.size.height as i32 - size.height as i32 - margin
    } else {
        area.position.y + margin
    };

    let window = window(app, NOTIFICATIONS_WINDOW)?;

    // Sized before it is moved: for a stack that grows downwards from the
    // bottom edge, the position depends on the height it is about to have.
    window.set_size(size).map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

/// The work area the current stack hangs in, chosen once per stack.
fn anchor(app: &AppHandle) -> Result<Anchor, String> {
    let state = app.state::<Notifications>();

    if let Some(anchor) = *lock(&state.anchor)? {
        return Ok(anchor);
    }

    let monitor = current_monitor(app)?;
    let anchor = Anchor {
        // The work area rather than the whole screen, so the toasts sit above
        // the taskbar instead of behind it.
        area: *monitor.work_area(),
        scale: monitor.scale_factor(),
    };

    *lock(&state.anchor)? = Some(anchor);

    Ok(anchor)
}

/// The screen the user is on: the one under the cursor, which is the rule
/// region capture already follows.
fn current_monitor(app: &AppHandle) -> Result<Monitor, String> {
    let under_cursor = app
        .cursor_position()
        .ok()
        .and_then(|cursor| app.monitor_from_point(cursor.x, cursor.y).ok().flatten());

    under_cursor
        .or_else(|| app.primary_monitor().ok().flatten())
        .or_else(|| {
            app.available_monitors()
                .ok()
                .and_then(|monitors| monitors.into_iter().next())
        })
        .ok_or_else(|| "no monitor to show notifications on".to_string())
}

/// Logical pixels, as the overlay measures them, into the physical ones the
/// window is sized and placed in.
fn to_physical(logical: f64, scale: f64) -> u32 {
    (logical * scale).round().max(0.0) as u32
}
