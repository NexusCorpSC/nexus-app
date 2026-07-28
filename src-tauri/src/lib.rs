mod capture;
mod diagnostics;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use capture::{Capture, Selection};
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use diagnostics::log;

/// Window labels declared in `tauri.conf.json`.
const MAIN_WINDOW: &str = "main";
const OVERLAY_WINDOW: &str = "overlay";
const CAPTURE_WINDOW: &str = "capture";
const NOTES_WINDOW: &str = "notes";

/// Carries recognised text to the overlay's search bar.
const SEARCH_EVENT: &str = "overlay://search";

/// Asks the main window to navigate to a route.
const NAVIGATE_EVENT: &str = "main://navigate";

/// Frozen monitor snapshot awaiting a selection: filled when the capture
/// shortcut fires, taken when the user releases the mouse.
#[derive(Default)]
struct CaptureState(Mutex<Option<Capture>>);

/// What a global shortcut triggers.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Action {
    Search,
    Capture,
    Notes,
}

impl Action {
    /// Name shared with the frontend, matching the keys of `Shortcuts` in
    /// `src/lib/settings.ts`.
    fn as_str(self) -> &'static str {
        match self {
            Action::Search => "search",
            Action::Capture => "capture",
            Action::Notes => "notes",
        }
    }
}

/// The combinations currently bound, so the handler can tell them apart after
/// the user has remapped them. An action missing from this list is simply not
/// bound: the system refused the combination and the app runs without it.
#[derive(Default)]
struct Shortcuts(Mutex<Vec<(Action, Shortcut)>>);

/// Whether the `global-shortcut` plugin registered at startup.
///
/// Binding a combination goes through state the plugin manages itself, and
/// `global_shortcut()` asks Tauri for that state — which panics when the plugin
/// is missing. `setup` deliberately lets the app start without it, so that
/// panic would be raised from a command running on the thread pumping the
/// message loop, where it cannot unwind: the process aborts. Asking here first
/// keeps a missing plugin costing only the shortcuts.
#[derive(Default)]
struct ShortcutSupport(AtomicBool);

impl ShortcutSupport {
    fn mark_available(&self) {
        self.0.store(true, Ordering::Relaxed);
    }

    fn is_available(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

/// The three combinations, in the format the `global-shortcut` plugin parses.
#[derive(Debug, Deserialize)]
struct ShortcutSettings {
    search: String,
    capture: String,
    notes: String,
}

impl Default for ShortcutSettings {
    fn default() -> Self {
        Self {
            search: "Ctrl+Shift+KeyB".to_string(),
            capture: "Ctrl+Shift+KeyS".to_string(),
            notes: "Ctrl+Shift+KeyN".to_string(),
        }
    }
}

/// A combination the app could not take, reported to Settings so the user can
/// pick another one. Never fatal: the other shortcuts still bind.
#[derive(Debug, Serialize)]
struct ShortcutRejection {
    action: &'static str,
    accelerator: String,
    reason: String,
}

fn parse_shortcut(raw: &str) -> Result<Shortcut, String> {
    raw.parse::<Shortcut>()
        .map_err(|error| format!("combinaison invalide : {error}"))
}

/// Binds the three global shortcuts, each one independently.
///
/// A combination already owned by another application is the common case
/// — `Ctrl+Shift+S` in particular is popular — and it must cost the user only
/// that one shortcut: the others still bind, the app still starts, and the
/// rejected ones are reported so Settings can suggest picking another.
fn apply_shortcuts(app: &AppHandle, requested: &ShortcutSettings) -> Vec<ShortcutRejection> {
    let wanted = [
        (Action::Search, &requested.search),
        (Action::Capture, &requested.capture),
        (Action::Notes, &requested.notes),
    ];

    // The plugin failed to start (see `setup`). Report the combinations as
    // rejected — Settings shows why — rather than reaching for state that was
    // never managed, which would abort the process.
    if !app.state::<ShortcutSupport>().is_available() {
        return wanted
            .into_iter()
            .map(|(action, accelerator)| ShortcutRejection {
                action: action.as_str(),
                accelerator: accelerator.clone(),
                reason: "les raccourcis globaux sont indisponibles sur ce système".to_string(),
            })
            .collect();
    }

    let manager = app.global_shortcut();

    if let Err(error) = manager.unregister_all() {
        log(format!("could not release the shortcuts: {error}"));
    }

    let mut bound: Vec<(Action, Shortcut)> = Vec::new();
    let mut rejected: Vec<ShortcutRejection> = Vec::new();

    for (action, accelerator) in wanted {
        let shortcut = match parse_shortcut(accelerator) {
            Ok(shortcut) => shortcut,
            Err(reason) => {
                rejected.push(ShortcutRejection {
                    action: action.as_str(),
                    accelerator: accelerator.clone(),
                    reason,
                });
                continue;
            }
        };

        let outcome = if bound.iter().any(|(_, already)| *already == shortcut) {
            Err("déjà utilisée par un autre raccourci de Nexus".to_string())
        } else {
            manager
                .register(shortcut)
                .map_err(|error| format!("refusée par le système ({error})"))
        };

        match outcome {
            Ok(()) => bound.push((action, shortcut)),
            Err(reason) => rejected.push(ShortcutRejection {
                action: action.as_str(),
                accelerator: accelerator.clone(),
                reason,
            }),
        }
    }

    for rejection in &rejected {
        log(format!(
            "shortcut `{}` for {} was not bound: {}",
            rejection.accelerator, rejection.action, rejection.reason
        ));
    }

    match app.state::<Shortcuts>().0.lock() {
        Ok(mut state) => *state = bound,
        // Only ever poisoned by a panic inside this very function; the
        // combinations stay registered, they just stop being routed.
        Err(_) => log("shortcut state is poisoned"),
    }

    rejected
}

impl CaptureState {
    fn take(&self) -> Result<Option<Capture>, String> {
        Ok(self.lock()?.take())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Option<Capture>>, String> {
        self.0
            .lock()
            .map_err(|_| "capture state is poisoned".to_string())
    }
}

fn window(app: &AppHandle, label: &str) -> Result<WebviewWindow, String> {
    app.get_webview_window(label)
        .ok_or_else(|| format!("window `{label}` is not declared"))
}

/// Shows a window and focuses it. Focus matters here: the shortcuts fire while
/// another application owns the foreground.
fn show_window(app: &AppHandle, label: &str) -> Result<(), String> {
    let window = window(app, label)?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

fn hide_window(app: &AppHandle, label: &str) -> Result<(), String> {
    window(app, label)?.hide().map_err(|e| e.to_string())
}

/// Shows the notes overlay, or hides it if it is already up.
///
/// Unlike the search palette this window stays open until it is dismissed
/// explicitly — the point is to keep notes readable while playing — so the
/// shortcut has to be able to put it away again.
fn toggle_notes_overlay(app: &AppHandle) -> Result<(), String> {
    let notes = window(app, NOTES_WINDOW)?;

    if notes.is_visible().map_err(|e| e.to_string())? {
        return notes.hide().map_err(|e| e.to_string());
    }

    show_window(app, NOTES_WINDOW)
}

/// Takes the overlay off screen, then freezes the monitor and offers a selection.
///
/// The palette suggests this very shortcut, so it is usually visible when the
/// shortcut fires — without this it would end up inside its own capture and be
/// fed to the OCR engine.
fn start_capture(app: &AppHandle) -> Result<(), String> {
    hide_window(app, OVERLAY_WINDOW)?;

    let app = app.clone();
    std::thread::spawn(move || {
        // Hiding a window only queues the repaint. Grabbing the pixels on this
        // thread — rather than sleeping on the caller's, which may be the one
        // pumping messages — lets the compositor actually clear it first.
        std::thread::sleep(Duration::from_millis(120));

        if let Err(error) = freeze_and_select(&app) {
            log(format!("region capture failed: {error}"));
        }
    });

    Ok(())
}

fn freeze_and_select(app: &AppHandle) -> Result<(), String> {
    let cursor = app.cursor_position().map_err(|e| e.to_string())?;
    let frame = capture::grab(cursor.x as i32, cursor.y as i32)?;
    let monitor = frame.monitor;

    app.state::<CaptureState>().lock()?.replace(frame);

    let selection_window = window(app, CAPTURE_WINDOW)?;
    // Cover exactly the monitor that was captured, so the normalised
    // coordinates sent back by the frontend map onto the snapshot one to one.
    selection_window
        .set_position(PhysicalPosition::new(monitor.x, monitor.y))
        .map_err(|e| e.to_string())?;
    selection_window
        .set_size(PhysicalSize::new(monitor.width, monitor.height))
        .map_err(|e| e.to_string())?;
    selection_window.show().map_err(|e| e.to_string())?;
    selection_window.set_focus().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn open_search_overlay(app: AppHandle) -> Result<(), String> {
    show_window(&app, OVERLAY_WINDOW)
}

/// Applies the shortcuts chosen in Settings and reports the ones the system
/// refused. Persisting them stays on the frontend, which owns the store.
#[tauri::command]
fn set_shortcuts(app: AppHandle, shortcuts: ShortcutSettings) -> Vec<ShortcutRejection> {
    apply_shortcuts(&app, &shortcuts)
}

#[tauri::command]
fn close_search_overlay(app: AppHandle) -> Result<(), String> {
    hide_window(&app, OVERLAY_WINDOW)
}

#[tauri::command]
fn close_notes_overlay(app: AppHandle) -> Result<(), String> {
    hide_window(&app, NOTES_WINDOW)
}

/// Opens a blueprint in the main window, from an overlay result.
#[tauri::command]
fn show_blueprint(app: AppHandle, slug: String) -> Result<(), String> {
    let main = window(&app, MAIN_WINDOW)?;
    main.show().map_err(|e| e.to_string())?;
    // The main window is usually minimised when the overlay is in use.
    let _ = main.unminimize();
    main.set_focus().map_err(|e| e.to_string())?;

    app.emit_to(MAIN_WINDOW, NAVIGATE_EVENT, format!("/blueprints/{slug}"))
        .map_err(|e| e.to_string())?;

    hide_window(&app, OVERLAY_WINDOW)
}

/// Drops the pending snapshot when the user abandons the selection.
#[tauri::command]
fn cancel_capture(app: AppHandle, state: State<CaptureState>) -> Result<(), String> {
    state.take()?;
    hide_window(&app, CAPTURE_WINDOW)
}

/// Reads the selected region and hands the text to the overlay's search bar.
#[tauri::command]
async fn recognize_selection(
    app: AppHandle,
    state: State<'_, CaptureState>,
    selection: Selection,
) -> Result<String, String> {
    let frame = state
        .take()?
        .ok_or_else(|| "no capture in progress".to_string())?;

    // Hide the selection window before recognising: OCR takes a moment, and a
    // fullscreen overlay left up in the meantime reads as a frozen app.
    hide_window(&app, CAPTURE_WINDOW)?;

    let recognized = frame.recognize(selection).await;

    // The overlay opens either way — a failed read should still leave the user
    // somewhere they can type.
    show_window(&app, OVERLAY_WINDOW)?;

    let text = recognized?;
    app.emit_to(OVERLAY_WINDOW, SEARCH_EVENT, text.clone())
        .map_err(|e| e.to_string())?;

    Ok(text)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before anything else: a panic raised while the app is being built, or
    // later on the message loop, aborts the process without printing anywhere a
    // packaged build can show. This is what turns that into a log line.
    diagnostics::install_panic_logger();

    let app = tauri::Builder::default()
        // `store` persists the API base URL and the better-auth session token.
        .plugin(tauri_plugin_store::Builder::new().build())
        // `http` performs API calls from Rust, so requests to the Nexus Tools
        // API are not subject to the webview's CORS policy and we can attach
        // the session cookie ourselves.
        .plugin(tauri_plugin_http::init())
        // `opener` sends external links to the user's real browser.
        .plugin(tauri_plugin_opener::init())
        .manage(CaptureState::default())
        .manage(Shortcuts::default())
        .manage(ShortcutSupport::default())
        .invoke_handler(tauri::generate_handler![
            open_search_overlay,
            set_shortcuts,
            close_search_overlay,
            close_notes_overlay,
            show_blueprint,
            cancel_capture,
            recognize_selection,
        ])
        .on_window_event(|window, event| {
            // Dismiss the search palette when it loses focus, the way a command
            // palette does — otherwise an always-on-top window stays in the
            // user's face after they click elsewhere. The notes overlay is
            // deliberately excluded: it is there to stay readable while the
            // user is doing something else.
            if window.label() == OVERLAY_WINDOW {
                if let WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            // Everything logged from here on lands next to the app's data
            // rather than in the process-wide fallback.
            diagnostics::init(app.handle());
            log(format!("Nexus App {} started", app.package_info().version));

            // Bound from Rust rather than the frontend so the shortcuts keep
            // working while the app is minimised, which is the point.
            //
            // Nothing here may abort the launch. Both the plugin and the
            // individual combinations depend on what the rest of the system
            // has already claimed, and losing a shortcut is no reason to deny
            // the user the app — Settings can rebind them.
            let plugin = tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    // Both edges are reported; act on the key going down.
                    if event.state != ShortcutState::Pressed {
                        return;
                    }

                    let action = app.state::<Shortcuts>().0.lock().ok().and_then(|bound| {
                        bound
                            .iter()
                            .find(|(_, candidate)| candidate == shortcut)
                            .map(|(action, _)| *action)
                    });

                    let outcome = match action {
                        Some(Action::Search) => show_window(app, OVERLAY_WINDOW),
                        Some(Action::Capture) => start_capture(app),
                        Some(Action::Notes) => toggle_notes_overlay(app),
                        None => Ok(()),
                    };

                    if let Err(error) = outcome {
                        log(format!("global shortcut failed: {error}"));
                    }
                })
                .build();

            match app.handle().plugin(plugin) {
                // The frontend replaces these with the stored combinations once
                // the main window has read the settings store.
                Ok(()) => {
                    app.state::<ShortcutSupport>().mark_available();
                    apply_shortcuts(app.handle(), &ShortcutSettings::default());
                }
                // `ShortcutSupport` stays false, so `set_shortcuts` reports the
                // combinations as rejected instead of asking the plugin — which
                // is not there — and taking the process down with it.
                Err(error) => log(format!("global shortcuts unavailable: {error}")),
            }

            Ok(())
        })
        .build(tauri::generate_context!());

    match app {
        Ok(app) => app.run(|_, _| {}),
        // The app was never built, so this goes to the fallback log directory:
        // on Windows the process would otherwise vanish without a trace,
        // release builds having no console to print to.
        Err(error) => {
            log(format!("Nexus App could not start: {error}"));
            std::process::exit(1);
        }
    }
}
