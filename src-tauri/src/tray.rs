//! Notification area icon.
//!
//! The app spends most of its life without a window on screen — the shortcuts
//! are the point, and the main window is usually minimised behind the game. The
//! tray icon is what says it is still running, and gives back a way in that
//! does not depend on a combination the system may have refused.

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Wry};

use crate::diagnostics::log;
use crate::native_labels::{self, NativeLabels};
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
const SQUAD_ITEM: &str = "tray-squad";
const PLAN_ITEM: &str = "tray-plan";
const MAP_ITEM: &str = "tray-map";
const NPS_ITEM: &str = "tray-nps";
const QUIT_ITEM: &str = "tray-quit";

const TRAY_ID: &str = "nexus-app";

/// The menu, in the language the webview last asked for.
fn build_menu(app: &AppHandle, labels: &NativeLabels) -> tauri::Result<Menu<Wry>> {
    let search = MenuItem::with_id(app, SEARCH_ITEM, &labels.search, true, None::<&str>)?;
    let capture = MenuItem::with_id(app, CAPTURE_ITEM, &labels.capture, true, None::<&str>)?;
    let notes = MenuItem::with_id(app, NOTES_ITEM, &labels.notes, true, None::<&str>)?;
    let cargo = MenuItem::with_id(app, CARGO_ITEM, &labels.cargo, true, None::<&str>)?;
    let squad = MenuItem::with_id(app, SQUAD_ITEM, &labels.squad, true, None::<&str>)?;
    let plan = MenuItem::with_id(app, PLAN_ITEM, &labels.plan, true, None::<&str>)?;
    let map = MenuItem::with_id(app, MAP_ITEM, &labels.map, true, None::<&str>)?;
    let nps = MenuItem::with_id(app, NPS_ITEM, &labels.nps, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, QUIT_ITEM, &labels.quit, true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &search, &capture, &notes, &cargo, &squad, &plan, &map, &nps, &separator, &quit,
        ],
    )
}

/// Swaps the menu for one in another language. The ids stay the same, so
/// `on_menu` needs no telling.
pub(crate) fn relabel(app: &AppHandle, labels: &NativeLabels) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    tray.set_menu(Some(build_menu(app, labels)?))
}

/// Adds the icon for as long as the app runs.
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app, &native_labels::current(app))?;

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
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
        SQUAD_ITEM => Action::Squad,
        PLAN_ITEM => Action::Plan,
        MAP_ITEM => Action::Map,
        NPS_ITEM => Action::Nps,
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
