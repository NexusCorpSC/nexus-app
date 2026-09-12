//! Toasts shown over the game: most in a corner of the screen, a few — the
//! ones that ask something of the whole squad — large, at the top, centred.
//!
//! They live in windows of their own rather than inside the main one: this app
//! spends most of its life minimised behind a game, and a notification nobody
//! can see is not a notification. Each window is sized to whatever its overlay
//! is showing and moved to its place, so the rest of the screen keeps taking
//! clicks — the window covers the toasts and nothing else.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalRect, PhysicalSize, Window,
};

use crate::diagnostics::log;
use crate::{window, BANNERS_WINDOW, NOTIFICATIONS_WINDOW};

/// Carries one notification to the overlay it is placed in.
const SHOW_EVENT: &str = "notifications://show";

/// Tells the corner overlay which corner it hangs from, so the stack grows
/// away from the edge and the toasts slide in from the right side.
const CORNER_EVENT: &str = "notifications://corner";

/// Gap left between the toasts and the edges of the work area, in logical
/// pixels — the same unit the overlays measure themselves in.
const MARGIN: f64 = 16.0;

/// How many notifications are held while an overlay is still loading.
const MAX_PENDING: usize = 8;

/// Where a notification is shown.
///
/// Two windows, one each: what is asked of the whole squad — an announcement,
/// a ready check — is not read in a corner while the game has the eyes, so it
/// goes large and centred at the top of the screen. Everything else stays in
/// the corner, where it is noticed without being in the way.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Placement {
    #[default]
    Corner,
    Top,
}

impl Placement {
    const ALL: [Placement; 2] = [Placement::Corner, Placement::Top];

    /// The window that draws this placement.
    fn window(self) -> &'static str {
        match self {
            Placement::Corner => NOTIFICATIONS_WINDOW,
            Placement::Top => BANNERS_WINDOW,
        }
    }

    /// The placement a window draws — the commands below are called by the
    /// overlays themselves, and which one is calling says where it is.
    fn of(window: &Window) -> Result<Placement, String> {
        let label = window.label();
        Placement::ALL
            .into_iter()
            .find(|placement| placement.window() == label)
            .ok_or_else(|| format!("window `{label}` shows no notifications"))
    }
}

/// Which corner the corner toasts hang from.
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

/// A button on the toast: pressing it broadcasts `event` with `payload` to
/// every window, and the one that raised the notification acts on it. The
/// overlay itself has neither the session nor the network to do anything.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationAction {
    label: String,
    event: String,
    #[serde(default)]
    payload: Option<Value>,
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
    /// A button, for the one thing the notification asks for.
    #[serde(default)]
    action: Option<NotificationAction>,
    /// The corner unless said otherwise.
    #[serde(default)]
    placement: Placement,
}

/// What an overlay receives.
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
    action: Option<NotificationAction>,
    placement: Placement,
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

/// What each window keeps for itself.
#[derive(Default)]
struct Slot {
    anchor: Mutex<Option<Anchor>>,
    /// Notifications raised before the overlay was listening.
    pending: Mutex<Vec<Notification>>,
    ready: AtomicBool,
}

#[derive(Default)]
pub struct Notifications {
    corner: Mutex<Corner>,
    slots: [Slot; 2],
    next_id: AtomicU64,
}

impl Notifications {
    /// Spelled out rather than cast from the discriminant: the array does not
    /// know the enum's order, and a variant added in the middle must not
    /// quietly hand one window the other's state.
    fn slot(&self, placement: Placement) -> &Slot {
        match placement {
            Placement::Corner => &self.slots[0],
            Placement::Top => &self.slots[1],
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, String> {
    mutex
        .lock()
        .map_err(|_| "notification state is poisoned".to_string())
}

/// Raises a corner notification from Rust.
pub(crate) fn push(app: &AppHandle, kind: Kind, title: impl Into<String>, body: Option<String>) {
    deliver(
        app,
        NotificationInput {
            kind,
            title: title.into(),
            body,
            timeout_ms: None,
            route: None,
            action: None,
            placement: Placement::Corner,
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
        action: input.action,
        placement: input.placement,
    };

    // The overlays are created hidden at startup and load the same bundle as
    // every other window, so a notification raised in the meantime would be
    // emitted to nobody. Held instead, and handed over when the overlay says
    // it is listening.
    let slot = state.slot(input.placement);
    if !slot.ready.load(Ordering::Acquire) {
        match lock(&slot.pending) {
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
    if let Err(error) = app.emit_to(notification.placement.window(), SHOW_EVENT, notification) {
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

/// Called by an overlay once it is listening.
///
/// Answers with the corner the corner toasts hang from — the top window has no
/// use for it — and hands over whatever was raised while the overlay was still
/// loading.
#[tauri::command]
pub fn notifications_ready(app: AppHandle, window: Window) -> Result<Corner, String> {
    let placement = Placement::of(&window)?;
    let state = app.state::<Notifications>();
    let slot = state.slot(placement);
    slot.ready.store(true, Ordering::Release);

    let pending = std::mem::take(&mut *lock(&slot.pending)?);
    for notification in &pending {
        emit(&app, notification);
    }

    // Read into a value of its own: a guard held to the end of the function
    // would outlive the state it borrows from.
    let corner = *lock(&state.corner)?;

    Ok(corner)
}

/// Sizes the calling window to the stack its overlay is showing, puts it in
/// its place and brings it up.
///
/// Called on every change to the stack: a window larger than its contents would
/// swallow clicks meant for whatever is underneath, which here is usually a
/// game.
#[tauri::command]
pub fn resize_notifications(
    app: AppHandle,
    window: Window,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let placement = Placement::of(&window)?;
    let anchor = anchor(&app, placement)?;

    // Never larger than the work area, margins included: a stack taller than
    // the screen would push its oldest toasts off it, and one wider than a
    // narrow screen would be centred past its edges.
    let margins = to_physical(MARGIN * 2.0, anchor.scale);
    let widest = anchor.area.size.width.saturating_sub(margins).max(1);
    let tallest = anchor.area.size.height.saturating_sub(margins).max(1);

    let size = PhysicalSize::new(
        to_physical(width, anchor.scale).clamp(1, widest),
        to_physical(height, anchor.scale).clamp(1, tallest),
    );

    place(&app, placement, &anchor, size)?;

    // Never focused: taking the foreground from a game to say something would
    // cost more than the notification is worth.
    crate::window(&app, placement.window())?
        .show()
        .map_err(|e| e.to_string())
}

/// Called by an overlay when its last toast is gone.
///
/// Drops its anchor as well, so the next stack picks the screen the user is
/// on then rather than the one they were on before.
#[tauri::command]
pub fn hide_notifications(app: AppHandle, window: Window) -> Result<(), String> {
    let placement = Placement::of(&window)?;
    *lock(&app.state::<Notifications>().slot(placement).anchor)? = None;

    crate::window(&app, placement.window())?
        .hide()
        .map_err(|e| e.to_string())
}

/// Applies the corner chosen in Settings. Persisting it stays on the frontend,
/// which owns the store. The top window is not concerned: centred is centred.
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
        let anchor = anchor(&app, Placement::Corner)?;
        let size = window.outer_size().map_err(|e| e.to_string())?;
        place(&app, Placement::Corner, &anchor, size)?;
    }

    Ok(())
}

fn place(
    app: &AppHandle,
    placement: Placement,
    anchor: &Anchor,
    size: PhysicalSize<u32>,
) -> Result<(), String> {
    let margin = to_physical(MARGIN, anchor.scale) as i32;
    let area = anchor.area;

    let (x, y) = match placement {
        Placement::Top => (
            area.position.x + (area.size.width as i32 - size.width as i32) / 2,
            area.position.y + margin,
        ),
        Placement::Corner => {
            let corner = *lock(&app.state::<Notifications>().corner)?;

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

            (x, y)
        }
    };

    let window = window(app, placement.window())?;

    // Sized before it is moved: for a stack that grows downwards from the
    // bottom edge, the position depends on the height it is about to have.
    window.set_size(size).map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

/// The work area the current stack of a window hangs in, chosen once per
/// stack.
fn anchor(app: &AppHandle, placement: Placement) -> Result<Anchor, String> {
    let state = app.state::<Notifications>();
    let slot = state.slot(placement);

    if let Some(anchor) = *lock(&slot.anchor)? {
        return Ok(anchor);
    }

    let monitor = current_monitor(app)?;
    let anchor = Anchor {
        // The work area rather than the whole screen, so the toasts sit above
        // the taskbar instead of behind it.
        area: *monitor.work_area(),
        scale: monitor.scale_factor(),
    };

    *lock(&slot.anchor)? = Some(anchor);

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

/// Logical pixels, as the overlays measure them, into the physical ones the
/// windows are sized and placed in.
fn to_physical(logical: f64, scale: f64) -> u32 {
    (logical * scale).round().max(0.0) as u32
}
