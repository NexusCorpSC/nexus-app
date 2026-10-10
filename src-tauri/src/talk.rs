//! "Talk to the chat": a shortcut held down while speaking, like a game's push
//! to talk.
//!
//! The microphone opens on the key going down, before anything else, so the
//! first word is not lost to the round trip through the webview. The chat
//! overlay comes up without taking the focus — the game keeps the keyboard
//! and the mouse — and is told about both edges (`chat-talk`): its page
//! decides what they mean (held then let go sends, a short tap starts a
//! recording the next tap finishes) and does the rest through the `voice_*`
//! commands.

#[cfg(windows)]
use std::sync::atomic::AtomicU64;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::diagnostics::log;
use crate::{window, CHAT_WINDOW};

/// The event the chat overlay listens to.
pub const TALK_EVENT: &str = "chat-talk";

/// Whether the combination is down. Both shortcut paths report it — the
/// system's and raw input — so each edge is only acted on once.
static HELD: AtomicBool = AtomicBool::new(false);

/// Counts the presses, so the watcher of an earlier one stands down.
#[cfg(windows)]
static PRESSES: AtomicU64 = AtomicU64::new(0);

/// How often the watcher asks the keyboard whether the keys are still down.
#[cfg(windows)]
const WATCH_TICK: std::time::Duration = std::time::Duration::from_millis(50);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TalkEvent {
    /// `pressed` or `released`.
    phase: &'static str,
    /// Why the microphone did not open, on `pressed`.
    error: Option<String>,
}

/// The combination went down. Must be called on the main thread.
pub fn press(app: &AppHandle) -> Result<(), String> {
    if HELD.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    // Opening goes on in the background: a slow audio driver must not hold
    // up the main thread. Why it failed, if it does, comes back on `voice_stop`.
    #[cfg(windows)]
    let (opened, error) = match crate::voice::start(CHAT_WINDOW) {
        Ok(opened) => (opened, None),
        Err(error) => (false, Some(error)),
    };
    #[cfg(not(windows))]
    let (opened, error) = (false, Some("unsupported".to_string()));

    if let Some(error) = &error {
        log(format!("talk: microphone not opened ({error})"));
    }

    let told = show_without_focus(app).and_then(|()| {
        app.emit_to(
            CHAT_WINDOW,
            TALK_EVENT,
            TalkEvent {
                phase: "pressed",
                error,
            },
        )
        .map_err(|e| e.to_string())
    });

    if let Err(error) = told {
        // Nobody would close a microphone the page never heard about — one
        // this press opened; a recording the page started is still its own.
        #[cfg(windows)]
        if opened {
            crate::voice::cancel(CHAT_WINDOW);
        }
        let _ = opened;
        HELD.store(false, Ordering::SeqCst);
        return Err(error);
    }

    #[cfg(windows)]
    watch(app.clone());

    Ok(())
}

/// Lets go of the combination once its keys are no longer down. Raw input and
/// the shortcut plugin both report the key going up, but one released while
/// another application was being switched to can slip past both: the page
/// would keep recording, and the shortcut would do nothing until then.
#[cfg(windows)]
fn watch(app: AppHandle) {
    let generation = PRESSES.fetch_add(1, Ordering::SeqCst) + 1;

    std::thread::spawn(move || loop {
        std::thread::sleep(WATCH_TICK);

        if !HELD.load(Ordering::SeqCst) || PRESSES.load(Ordering::SeqCst) != generation {
            return;
        }

        if crate::hotkeys::let_go(crate::Action::Talk) {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || release(&handle));
            return;
        }
    });
}

/// The combination, or one of its keys, went up.
pub fn release(app: &AppHandle) {
    if !HELD.swap(false, Ordering::SeqCst) {
        return;
    }

    if let Err(error) = app.emit_to(
        CHAT_WINDOW,
        TALK_EVENT,
        TalkEvent {
            phase: "released",
            error: None,
        },
    ) {
        log(format!("talk: release not delivered ({error})"));
    }
}

/// Whether the combination is down.
pub fn is_held() -> bool {
    HELD.load(Ordering::SeqCst)
}

/// Brings the chat overlay up without activating it: the game keeps the
/// keyboard and the mouse. Left as it is when already on screen.
fn show_without_focus(app: &AppHandle) -> Result<(), String> {
    let overlay = window(app, CHAT_WINDOW)?;

    if overlay.is_visible().map_err(|e| e.to_string())? {
        return Ok(());
    }

    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};

        let handle = overlay.hwnd().map_err(|e| e.to_string())?;
        // `show()` activates the window, which would take the game's focus.
        unsafe {
            let _ = ShowWindow(HWND(handle.0), SW_SHOWNOACTIVATE);
        }
        Ok(())
    }

    #[cfg(not(windows))]
    overlay.show().map_err(|e| e.to_string())
}
