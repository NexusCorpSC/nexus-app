mod capture;
mod diagnostics;
#[cfg(windows)]
mod hotkeys;
mod notifications;
mod tray;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use capture::{Capture, Selection};
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use diagnostics::log;
use notifications::Kind;

/// Window labels declared in `tauri.conf.json`.
const MAIN_WINDOW: &str = "main";
const OVERLAY_WINDOW: &str = "overlay";
const CAPTURE_WINDOW: &str = "capture";
const NOTES_WINDOW: &str = "notes";
pub(crate) const NOTIFICATIONS_WINDOW: &str = "notifications";

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
pub(crate) enum Action {
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

/// How long the same action is ignored after it fires.
///
/// A combination is reported twice over: once by `RegisterHotKey`, once by the
/// raw input listener, which sits upstream and sees the keys first. Holding the
/// keys down then repeats it many times a second.
const TRIGGER_DEBOUNCE: Duration = Duration::from_millis(300);

static LAST_TRIGGER: Mutex<Option<(Action, Instant)>> = Mutex::new(None);

/// Runs what a shortcut is bound to, whichever path reported it.
///
/// Must be called on the main thread: it shows and focuses windows.
pub(crate) fn trigger(app: &AppHandle, action: Action, source: &str) {
    // A poisoned lock — a panic inside this function — falls through on
    // purpose: acting twice on a combination beats not acting at all.
    if let Ok(mut last) = LAST_TRIGGER.lock() {
        if let Some((previous, at)) = *last {
            if previous == action && at.elapsed() < TRIGGER_DEBOUNCE {
                return;
            }
        }

        *last = Some((action, Instant::now()));
    }

    // The line that says whether a shortcut reached the app at all, which is
    // the first thing to know when a game is holding the keyboard.
    log(format!("shortcut {} fired ({source})", action.as_str()));

    let outcome = match action {
        Action::Search => show_window(app, OVERLAY_WINDOW),
        Action::Capture => start_capture(app),
        Action::Notes => toggle_notes_overlay(app),
    };

    if let Err(error) = outcome {
        log(format!("global shortcut failed: {error}"));
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
/// Two paths watch for them, and a combination needs only one of the two:
///
/// * `RegisterHotKey`, through the plugin, is the one that can keep the
///   combination from reaching the application underneath — but it is not
///   delivered while a game holds the keyboard, which is most of the time this
///   app is useful;
/// * the raw input listener sees every keystroke whatever has focus, and needs
///   no registration at all, so a combination another application already owns
///   still reaches us.
///
/// Only a combination that cannot be parsed, or that is asked for twice, is
/// therefore reported to Settings as rejected.
fn apply_shortcuts(app: &AppHandle, requested: &ShortcutSettings) -> Vec<ShortcutRejection> {
    let wanted = [
        (Action::Search, &requested.search),
        (Action::Capture, &requested.capture),
        (Action::Notes, &requested.notes),
    ];

    let mut bound: Vec<(Action, Shortcut)> = Vec::new();
    let mut rejected: Vec<ShortcutRejection> = Vec::new();

    for (action, accelerator) in wanted {
        let outcome = match parse_shortcut(accelerator) {
            Ok(shortcut) if bound.iter().any(|(_, already)| *already == shortcut) => {
                Err("déjà utilisée par un autre raccourci de Nexus".to_string())
            }
            Ok(shortcut) => Ok(shortcut),
            Err(reason) => Err(reason),
        };

        match outcome {
            Ok(shortcut) => bound.push((action, shortcut)),
            Err(reason) => rejected.push(ShortcutRejection {
                action: action.as_str(),
                accelerator: accelerator.clone(),
                reason,
            }),
        }
    }

    // Watched whatever the system has to say about them: this is the path that
    // still works with Star Citizen in the foreground.
    #[cfg(windows)]
    hotkeys::set_bindings(&bound);

    let unregistered = register_system_wide(app, &bound);

    // Where there is no raw input to fall back on, a refusal really does cost
    // the shortcut, and Settings has to say so.
    #[cfg(not(windows))]
    for (action, accelerator) in wanted {
        if let Some((_, reason)) = unregistered
            .iter()
            .find(|(candidate, _)| *candidate == action)
        {
            rejected.push(ShortcutRejection {
                action: action.as_str(),
                accelerator: accelerator.clone(),
                reason: reason.clone(),
            });
        }
    }

    // Raw input watches for them regardless, so there is nothing to report.
    #[cfg(windows)]
    drop(unregistered);

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

/// Claims the combinations with `RegisterHotKey`, through the plugin, and
/// answers with the ones it could not claim and why.
///
/// Best effort throughout: where raw input is watching, a refusal costs the
/// exclusivity — the application underneath keeps receiving the combination —
/// and nothing else. Where it is not, the caller turns what comes back here
/// into something Settings can show.
fn register_system_wide(app: &AppHandle, bound: &[(Action, Shortcut)]) -> Vec<(Action, String)> {
    if !app.state::<ShortcutSupport>().is_available() {
        log("shortcuts are not registered system-wide: the plugin is unavailable");

        return bound
            .iter()
            .map(|(action, _)| {
                (
                    *action,
                    "les raccourcis globaux sont indisponibles sur ce système".to_string(),
                )
            })
            .collect();
    }

    let manager = app.global_shortcut();

    if let Err(error) = manager.unregister_all() {
        log(format!("could not release the shortcuts: {error}"));
    }

    let mut unregistered = Vec::new();

    for (action, shortcut) in bound {
        if let Err(error) = manager.register(*shortcut) {
            log(format!(
                "shortcut for {} is not registered system-wide: {error}",
                action.as_str()
            ));

            unregistered.push((*action, format!("refusée par le système ({error})")));
        }
    }

    unregistered
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

pub(crate) fn window(app: &AppHandle, label: &str) -> Result<WebviewWindow, String> {
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

/// Brings the main window back from wherever it was left: hidden by its close
/// button, or minimised behind the game.
pub(crate) fn show_main_window(app: &AppHandle) -> Result<(), String> {
    let main = window(app, MAIN_WINDOW)?;
    main.show().map_err(|e| e.to_string())?;
    let _ = main.unminimize();
    main.set_focus().map_err(|e| e.to_string())
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
            // The shortcut fires with no window of ours on screen, so a
            // notification is the only place this can be seen.
            notifications::push(&app, Kind::Error, "Capture impossible", Some(error));
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

/// Opens a route in the main window, for the windows that have nowhere to show
/// the thing themselves: a notification the user clicked, a result picked in
/// the search palette.
///
/// Both are used while the main window is put away — that is the point of them
/// — so acting on one has to bring the window back first.
#[tauri::command]
fn open_main_route(app: AppHandle, route: String) -> Result<(), String> {
    show_main_window(&app)?;

    app.emit_to(MAIN_WINDOW, NAVIGATE_EVENT, route)
        .map_err(|e| e.to_string())
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

    let text = match recognized {
        Ok(text) => text,
        // The selection window is gone by now and the caller lives in it, so
        // it has nowhere left to show this.
        Err(error) => {
            notifications::push(
                &app,
                Kind::Error,
                "Lecture du texte impossible",
                Some(error.clone()),
            );

            return Err(error);
        }
    };

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
        .manage(notifications::Notifications::default())
        .invoke_handler(tauri::generate_handler![
            open_search_overlay,
            set_shortcuts,
            close_search_overlay,
            close_notes_overlay,
            open_main_route,
            cancel_capture,
            recognize_selection,
            notifications::notify,
            notifications::notifications_ready,
            notifications::resize_notifications,
            notifications::hide_notifications,
            notifications::set_notification_corner,
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

            // Closing the main window puts it away rather than destroying it:
            // the app goes on running behind its tray icon, and the icon has to
            // have something left to open. Quitting is the tray's own item.
            if window.label() == MAIN_WINDOW {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            // Everything logged from here on lands next to the app's data
            // rather than in the process-wide fallback.
            diagnostics::init(app.handle());
            log(format!("Nexus App {} started", app.package_info().version));

            // Says the app is running, and gives a way in that does not depend
            // on a combination the system may have refused. Not fatal either:
            // a tray the system will not take is no reason to deny the app.
            if let Err(error) = tray::install(app.handle()) {
                log(format!("tray icon unavailable: {error}"));
            }

            // Registered here rather than on the builder, and fallibly: the
            // updater parses its own configuration when it starts, and a
            // configuration it refuses would otherwise take the whole launch
            // down with it. Losing the update check is no reason to deny the
            // user the app — the same rule the global shortcuts follow below.
            if let Err(error) = app
                .handle()
                .plugin(tauri_plugin_updater::Builder::new().build())
            {
                log(format!("updates unavailable: {error}"));
            }

            // Reads the keyboard whatever has focus, which is what makes the
            // shortcuts work with a game in the foreground. Started before the
            // combinations are applied: it is what they are handed to.
            #[cfg(windows)]
            hotkeys::start(app.handle().clone());

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

                    if let Some(action) = action {
                        trigger(app, action, "hotkey");
                    }
                })
                .build();

            match app.handle().plugin(plugin) {
                // The frontend replaces these with the stored combinations once
                // the main window has read the settings store.
                Ok(()) => app.state::<ShortcutSupport>().mark_available(),
                // `ShortcutSupport` stays false, so `apply_shortcuts` leaves the
                // system-wide registration alone instead of asking the plugin
                // — which is not there — and taking the process down with it.
                Err(error) => log(format!("global shortcuts unavailable: {error}")),
            }

            apply_shortcuts(app.handle(), &ShortcutSettings::default());

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
