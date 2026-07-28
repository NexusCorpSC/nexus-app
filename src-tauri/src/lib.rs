mod capture;

use std::sync::Mutex;

use capture::{Capture, Selection};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

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

/// Freezes the monitor under the cursor, then covers it with the selection window.
fn start_capture(app: &AppHandle) -> Result<(), String> {
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
        .invoke_handler(tauri::generate_handler![
            open_search_overlay,
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
            // Registered from Rust rather than the frontend so the shortcuts
            // work while the app is minimised, which is the point.
            let search = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyB);
            let region = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyS);

            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_shortcuts([search, region])?
                    .with_handler(move |app, shortcut, event| {
                        // Both edges are reported; act on the key going down.
                        if event.state != ShortcutState::Pressed {
                            return;
                        }

                        let outcome = if *shortcut == search {
                            show_overlay(app)
                        } else if *shortcut == region {
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

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
