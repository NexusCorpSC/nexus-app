mod capture;

use std::sync::Mutex;
use std::time::Duration;

use capture::{Capture, Selection};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Shortcuts registered until the frontend applies the stored ones. Key names
/// follow `KeyboardEvent.code`, so what the settings screen records maps across
/// unchanged (see `src/lib/settings.ts`).
const DEFAULT_SEARCH_SHORTCUT: &str = "Ctrl+Shift+KeyB";
const DEFAULT_CAPTURE_SHORTCUT: &str = "Ctrl+Shift+KeyS";

/// Window labels declared in `tauri.conf.json`.
const MAIN_WINDOW: &str = "main";
const OVERLAY_WINDOW: &str = "overlay";
const CAPTURE_WINDOW: &str = "capture";

/// Carries recognised text to the overlay's search bar.
const SEARCH_EVENT: &str = "overlay://search";

/// Asks the main window to navigate to a route.
const NAVIGATE_EVENT: &str = "main://navigate";

/// Frozen monitor snapshot awaiting a selection: filled when the capture
/// shortcut fires, taken when the user releases the mouse.
#[derive(Default)]
struct CaptureState(Mutex<Option<Capture>>);

/// The shortcuts currently bound, so the handler can tell them apart after the
/// user has remapped them.
#[derive(Clone, Copy)]
struct BoundShortcuts {
    search: Shortcut,
    capture: Shortcut,
}

#[derive(Default)]
struct Shortcuts(Mutex<Option<BoundShortcuts>>);

fn parse_shortcut(raw: &str) -> Result<Shortcut, String> {
    raw.parse::<Shortcut>()
        .map_err(|e| format!("raccourci invalide « {raw} » : {e}"))
}

/// Rebinds both global shortcuts, restoring the previous pair if the new one
/// cannot be taken — a combination already owned by another application is the
/// common case, and it must not leave the app with nothing bound.
fn apply_shortcuts(app: &AppHandle, search: &str, capture: &str) -> Result<(), String> {
    let search = parse_shortcut(search)?;
    let capture = parse_shortcut(capture)?;

    if search == capture {
        return Err("les deux raccourcis doivent être différents".to_string());
    }

    let state = app.state::<Shortcuts>();
    let previous = *state.0.lock().map_err(|_| "shortcut state poisoned")?;

    let manager = app.global_shortcut();
    manager.unregister_all().map_err(|e| e.to_string())?;

    match manager
        .register(search)
        .and_then(|()| manager.register(capture))
    {
        Ok(()) => {
            *state.0.lock().map_err(|_| "shortcut state poisoned")? =
                Some(BoundShortcuts { search, capture });
            Ok(())
        }
        Err(error) => {
            let _ = manager.unregister_all();
            if let Some(previous) = previous {
                let _ = manager.register(previous.search);
                let _ = manager.register(previous.capture);
            }
            Err(format!("impossible d'enregistrer ce raccourci : {error}"))
        }
    }
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

/// Shows the overlay and focuses it. Focus matters here: the shortcut fires
/// while another application owns the foreground.
fn show_overlay(app: &AppHandle) -> Result<(), String> {
    let overlay = window(app, OVERLAY_WINDOW)?;
    overlay.show().map_err(|e| e.to_string())?;
    overlay.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

fn hide_window(app: &AppHandle, label: &str) -> Result<(), String> {
    window(app, label)?.hide().map_err(|e| e.to_string())
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
            eprintln!("region capture failed: {error}");
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
    show_overlay(&app)
}

/// Applies the shortcuts chosen in Settings. Persisting them stays on the
/// frontend, which already owns the settings store.
#[tauri::command]
fn set_shortcuts(app: AppHandle, search: String, capture: String) -> Result<(), String> {
    apply_shortcuts(&app, &search, &capture)
}

#[tauri::command]
fn close_search_overlay(app: AppHandle) -> Result<(), String> {
    hide_window(&app, OVERLAY_WINDOW)
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
    show_overlay(&app)?;

    let text = recognized?;
    app.emit_to(OVERLAY_WINDOW, SEARCH_EVENT, text.clone())
        .map_err(|e| e.to_string())?;

    Ok(text)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        .invoke_handler(tauri::generate_handler![
            open_search_overlay,
            set_shortcuts,
            close_search_overlay,
            show_blueprint,
            cancel_capture,
            recognize_selection,
        ])
        .on_window_event(|window, event| {
            // Dismiss the overlay when it loses focus, the way a command
            // palette does — otherwise an always-on-top window stays in the
            // user's face after they click elsewhere.
            if window.label() == OVERLAY_WINDOW {
                if let WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            // Bound from Rust rather than the frontend so the shortcuts keep
            // working while the app is minimised, which is the point.
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, shortcut, event| {
                        // Both edges are reported; act on the key going down.
                        if event.state != ShortcutState::Pressed {
                            return;
                        }

                        let Some(bound) = app
                            .state::<Shortcuts>()
                            .0
                            .lock()
                            .ok()
                            .and_then(|current| *current)
                        else {
                            return;
                        };

                        let outcome = if *shortcut == bound.search {
                            show_overlay(app)
                        } else if *shortcut == bound.capture {
                            start_capture(app)
                        } else {
                            Ok(())
                        };

                        if let Err(error) = outcome {
                            eprintln!("global shortcut failed: {error}");
                        }
                    })
                    .build(),
            )?;

            // The frontend overrides these with the stored pair once it boots.
            //
            // Failing here must not stop the launch: a default combination may
            // already be owned by another application, and that is no reason to
            // deny the user the rest of the app.
            if let Err(error) = apply_shortcuts(
                app.handle(),
                DEFAULT_SEARCH_SHORTCUT,
                DEFAULT_CAPTURE_SHORTCUT,
            ) {
                eprintln!("cannot bind default shortcuts: {error}");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
