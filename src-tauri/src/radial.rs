//! The quick radial menu: up while its shortcut is held, gone on release.
//!
//! Over a game the cursor is locked and hidden, so the menu cannot be aimed by
//! pointing at it. What steers it is the mouse's *movement*: every nudge moves
//! a pointer away from the centre, and the direction it ends up in picks the
//! sector. On Windows that movement comes from raw input (`hotkeys.rs`), which
//! reads the mouse whatever has focus — the game keeps the keyboard and the
//! mouse, and the menu never takes either. Elsewhere, where there is no game to
//! share with, the cursor's travel since the press stands in for it.
//!
//! Which sectors exist, and what each one does, is the webview's business: it
//! is the one that knows whether the reader is in a squad. This side only says
//! when the menu opens, where the pointer is, and whether it was let go or
//! called off.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, PhysicalPosition};

use crate::diagnostics::log;
use crate::window;

/// Window label declared in `tauri.conf.json`.
pub(crate) const RADIAL_WINDOW: &str = "radial";

/// The menu came up, carrying the combination that holds it open.
const OPEN_EVENT: &str = "radial://open";

/// Where the pointer is, as a vector from the centre whose length is 1 at the
/// rim.
const POINTER_EVENT: &str = "radial://pointer";

/// The shortcut was let go: act on the sector under the pointer it carries.
const RELEASE_EVENT: &str = "radial://release";

/// Called off: nothing is to be done.
const CANCEL_EVENT: &str = "radial://cancel";

/// How far the pointer travels, in mouse counts, from the centre to the rim.
///
/// It stops there rather than running on, so changing one's mind costs the
/// same short flick whatever came before. A few centimetres at common
/// sensitivities: enough that a hand resting on the mouse picks nothing, short
/// enough that picking is a flick.
const REACH: f64 = 160.0;

/// How often the pointer is sent while the menu is up — a frame at 60 Hz.
const TICK: Duration = Duration::from_millis(16);

struct Hold {
    open: bool,
    /// The pointer, in mouse counts from the centre, never past `REACH`.
    x: f64,
    y: f64,
    /// What the window was last told, so an idle mouse costs no event.
    sent: (f64, f64),
    /// Counts the menus ever opened, so the watcher of one that closed cannot
    /// speak for the next.
    generation: u64,
    /// The combination bound to the menu, as Settings wrote it.
    accelerator: Option<String>,
}

static HOLD: Mutex<Hold> = Mutex::new(Hold {
    open: false,
    x: 0.0,
    y: 0.0,
    sent: (0.0, 0.0),
    generation: 0,
    accelerator: None,
});

#[derive(Clone, Copy, Serialize)]
struct Pointer {
    x: f64,
    y: f64,
}

#[derive(Clone, Serialize)]
struct Opened {
    accelerator: Option<String>,
}

/// Records the combination bound to the menu, for the hint it shows.
pub(crate) fn set_accelerator(accelerator: Option<String>) {
    if let Ok(mut hold) = HOLD.lock() {
        hold.accelerator = accelerator;
    }
}

pub(crate) fn is_open() -> bool {
    HOLD.lock().map(|hold| hold.open).unwrap_or(false)
}

/// The shortcut went down: bring the menu up, if it is not already.
///
/// Called again and again while the keys are held — auto-repeat, and both
/// shortcut paths reporting the same press — and only the first call counts.
pub(crate) fn press(app: &AppHandle) -> Result<(), String> {
    let (generation, accelerator) = {
        let mut hold = HOLD.lock().map_err(|e| e.to_string())?;
        if hold.open {
            return Ok(());
        }

        hold.open = true;
        hold.x = 0.0;
        hold.y = 0.0;
        hold.sent = (0.0, 0.0);
        hold.generation += 1;

        (hold.generation, hold.accelerator.clone())
    };

    log("radial menu opened");

    // Told before it is shown, so the first frame is already the fresh menu
    // rather than whatever the last one was left on.
    app.emit_to(RADIAL_WINDOW, OPEN_EVENT, Opened { accelerator })
        .map_err(|e| e.to_string())?;

    if let Err(error) = show(app) {
        if let Ok(mut hold) = HOLD.lock() {
            hold.open = false;
        }
        return Err(error);
    }

    #[cfg(windows)]
    crate::hotkeys::watch_mouse(true);

    watch(app.clone(), generation);

    Ok(())
}

/// The shortcut was let go: the webview acts on the sector under the pointer.
pub(crate) fn release(app: &AppHandle) {
    finish(app, true);
}

/// Called off: the menu goes away and nothing is done.
pub(crate) fn cancel(app: &AppHandle) {
    finish(app, false);
}

/// Moves the pointer by a stretch of mouse travel. Ignored while the menu is
/// down, which is nearly always: the mouse is only watched while it is up, but
/// a movement already on its way when it closed still arrives.
#[cfg(windows)]
pub(crate) fn nudge(dx: f64, dy: f64) {
    if let Ok(mut hold) = HOLD.lock() {
        if !hold.open {
            return;
        }
        let (x, y) = clamp(hold.x + dx, hold.y + dy);
        hold.x = x;
        hold.y = y;
    }
}

fn clamp(x: f64, y: f64) -> (f64, f64) {
    let length = x.hypot(y);
    if length > REACH {
        (x * REACH / length, y * REACH / length)
    } else {
        (x, y)
    }
}

fn finish(app: &AppHandle, commit: bool) {
    let pointer = {
        let Ok(mut hold) = HOLD.lock() else {
            return;
        };
        if !hold.open {
            return;
        }
        hold.open = false;

        Pointer {
            x: hold.x / REACH,
            y: hold.y / REACH,
        }
    };

    #[cfg(windows)]
    crate::hotkeys::watch_mouse(false);

    // Hidden before the webview acts: the capture it may start freezes the
    // screen, and the menu has no business being in the picture.
    if let Err(error) = window(app, RADIAL_WINDOW).and_then(|w| w.hide().map_err(|e| e.to_string()))
    {
        log(format!("cannot hide the radial menu: {error}"));
    }

    let outcome = if commit {
        app.emit_to(RADIAL_WINDOW, RELEASE_EVENT, pointer)
    } else {
        app.emit_to(RADIAL_WINDOW, CANCEL_EVENT, ())
    };

    if let Err(error) = outcome {
        log(format!("cannot tell the radial menu it closed: {error}"));
    }

    log(if commit {
        "radial menu released"
    } else {
        "radial menu cancelled"
    });
}

/// Centres the menu on the screen the cursor is on — the game's, over a game,
/// which parks its hidden cursor in the middle of its own screen — and shows it
/// without focus. The window cannot take focus at all (`focusable: false`), and
/// ignores the mouse: the game must keep both.
fn show(app: &AppHandle) -> Result<(), String> {
    let menu = window(app, RADIAL_WINDOW)?;

    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|cursor| app.monitor_from_point(cursor.x, cursor.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());

    if let Some(monitor) = monitor {
        let size = menu.outer_size().map_err(|e| e.to_string())?;
        let origin = monitor.position();
        let screen = monitor.size();

        let x = origin.x + (screen.width as i32 - size.width as i32) / 2;
        let y = origin.y + (screen.height as i32 - size.height as i32) / 2;

        menu.set_position(PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }

    menu.set_ignore_cursor_events(true)
        .map_err(|e| e.to_string())?;
    menu.show().map_err(|e| e.to_string())
}

/// Sends the pointer while the menu is up, and — on Windows — closes it once
/// the keys are no longer held.
///
/// The key going up is reported by raw input and by the shortcut plugin, but a
/// key released while another application was being switched to can slip past
/// both. Asking the keyboard every frame cannot miss it: a menu left up with
/// nobody holding it would sit over the game for good.
fn watch(app: AppHandle, generation: u64) {
    #[cfg(not(windows))]
    let origin = app.cursor_position().ok();

    std::thread::spawn(move || loop {
        std::thread::sleep(TICK);

        #[cfg(not(windows))]
        let travelled = match (origin, app.cursor_position()) {
            (Some(origin), Ok(cursor)) => Some(clamp(cursor.x - origin.x, cursor.y - origin.y)),
            _ => None,
        };

        let pointer = {
            let Ok(mut hold) = HOLD.lock() else {
                return;
            };
            if !hold.open || hold.generation != generation {
                return;
            }

            #[cfg(not(windows))]
            if let Some((x, y)) = travelled {
                hold.x = x;
                hold.y = y;
            }

            let now = (hold.x, hold.y);
            if now == hold.sent {
                None
            } else {
                hold.sent = now;
                Some(Pointer {
                    x: now.0 / REACH,
                    y: now.1 / REACH,
                })
            }
        };

        if let Some(pointer) = pointer {
            let _ = app.emit_to(RADIAL_WINDOW, POINTER_EVENT, pointer);
        }

        #[cfg(windows)]
        if !crate::hotkeys::radial_held() {
            release(&app);
            return;
        }
    });
}
