//! Notification area icon.
//!
//! The app spends most of its life without a window on screen — the shortcuts
//! are the point, and the main window is usually minimised behind the game. The
//! tray icon is what says it is still running, and gives back a way in that
//! does not depend on a combination the system may have refused.

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;

use crate::diagnostics::log;
use crate::{show_main_window, trigger, Action};

/// The Nexus Corp logo, taken at 128 px rather than at the 32 px of the window
/// icon: the notification area asks for anything between 16 and 32 pixels
/// depending on the display, and a large source scales down better than a
/// small one scales up.
const ICON: &[u8] = include_bytes!("../icons/128x128.png");

const SEARCH_ITEM: &str = "tray-search";
const CAPTURE_ITEM: &str = "tray-capture";
const NOTES_ITEM: &str = "tray-notes";
const CARGO_ITEM: &str = "tray-cargo";
const QUIT_ITEM: &str = "tray-quit";

/// Adds the icon for as long as the app runs.
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let search = MenuItem::with_id(app, SEARCH_ITEM, "Recherche rapide", true, None::<&str>)?;
    let capture = MenuItem::with_id(app, CAPTURE_ITEM, "Capture de zone", true, None::<&str>)?;
    let notes = MenuItem::with_id(app, NOTES_ITEM, "Bloc-notes", true, None::<&str>)?;
    let cargo = MenuItem::with_id(app, CARGO_ITEM, "Feuille de cargo", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, QUIT_ITEM, "Quitter Nexus App", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&search, &capture, &notes, &cargo, &separator, &quit])?;

    let mut tray = TrayIconBuilder::with_id("nexus-app")
        .tooltip("Nexus App")
        .menu(&menu)
        // Windows convention, and what the request asks for: the left button
        // opens the app, the menu belongs to the right one.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            // `Up` rather than `Down`: acting on the press would open the
            // window from under a click the user has not finished making.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                open_main_window(tray.app_handle());
            }
        });

    // Falls back on the window icon — the same logo, one size down — if the
    // embedded PNG ever fails to decode. A tray icon that ends up blank is
    // very hard to find again in the notification area.
    match Image::from_bytes(ICON) {
        Ok(icon) => tray = tray.icon(icon),
        Err(error) => {
            log(format!("tray icon could not be decoded: {error}"));

            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
        }
    }

    tray.build(app)?;

    Ok(())
}

fn on_menu(app: &AppHandle, item: &str) {
    let action = match item {
        SEARCH_ITEM => Action::Search,
        CAPTURE_ITEM => Action::Capture,
        NOTES_ITEM => Action::Notes,
        CARGO_ITEM => Action::Cargo,
        QUIT_ITEM => {
            log("quitting from the tray");
            // Closes every window and ends the process, which is the only way
            // out now that closing the main window merely puts it away.
            app.exit(0);
            return;
        }
        _ => return,
    };

    // Same route as a shortcut, so the log says where it came from and the
    // notes overlay still toggles rather than only ever opening.
    let handle = app.clone();
    dispatch(app, move || trigger(&handle, action, "tray"));
}

fn open_main_window(app: &AppHandle) {
    let handle = app.clone();

    dispatch(app, move || {
        if let Err(error) = show_main_window(&handle) {
            log(format!("tray could not open the main window: {error}"));
        }
    });
}

/// Hands `task` to the main thread, which is where windows may be touched.
///
/// A dispatch that fails leaves the menu item doing nothing at all, so it is
/// the one thing here worth a line in the log.
fn dispatch<F: FnOnce() + Send + 'static>(app: &AppHandle, task: F) {
    if let Err(error) = app.run_on_main_thread(task) {
        log(format!("tray could not reach the main thread: {error}"));
    }
}
