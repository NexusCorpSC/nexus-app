//! The few texts the native side shows on its own: the tray menu, and the
//! notifications it raises when a capture fails with no window of ours left
//! to say so.
//!
//! Translations live in the webview, with every other text of the app. It
//! hands these over when it starts and whenever the language changes; until
//! then the French ones below stand in, French being the app's fallback.
//!
//! The language travels with them, for the windows that cannot read it from
//! the store — radial menu, capture, notifications — because the store also
//! holds the session cookie, which they are kept away from.

use std::sync::Mutex;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::tray;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeLabels {
    pub search: String,
    pub capture: String,
    pub notes: String,
    pub cargo: String,
    pub squad: String,
    pub plan: String,
    pub map: String,
    /// Missing from what a frontend older than the NPS sends.
    #[serde(default = "default_nps_label")]
    pub nps: String,
    pub quit: String,
    pub capture_failed: String,
    pub ocr_failed: String,
    /// The language these are in. Missing from what a frontend older than
    /// it sends.
    #[serde(default)]
    pub locale: Option<String>,
}

impl Default for NativeLabels {
    fn default() -> Self {
        Self {
            search: "Recherche rapide".into(),
            capture: "Capture de zone".into(),
            notes: "Bloc-notes".into(),
            cargo: "Feuille de cargo".into(),
            squad: "Escouade".into(),
            plan: "Plan de vol".into(),
            map: "Carte".into(),
            nps: default_nps_label(),
            quit: "Quitter Nexus App".into(),
            capture_failed: "Capture impossible".into(),
            ocr_failed: "Lecture du texte impossible".into(),
            locale: None,
        }
    }
}

fn default_nps_label() -> String {
    "NPS".into()
}

#[derive(Default)]
pub(crate) struct NativeLabelsState(Mutex<NativeLabels>);

/// The labels in force, French if the webview has not spoken yet.
pub(crate) fn current(app: &AppHandle) -> NativeLabels {
    app.state::<NativeLabelsState>()
        .0
        .lock()
        .map(|labels| labels.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub(crate) fn set_native_labels(
    app: AppHandle,
    state: State<'_, NativeLabelsState>,
    labels: NativeLabels,
) -> Result<(), String> {
    let previous = std::mem::replace(
        &mut *state.0.lock().map_err(|error| error.to_string())?,
        labels.clone(),
    );

    // A window without the store that asked before the main window spoke got
    // the system language: it hears the stored one here. Only on a change, as
    // the main window answers this event by sending its labels again.
    if labels.locale != previous.locale {
        if let Some(locale) = &labels.locale {
            app.emit(LOCALE_EVENT, locale)
                .map_err(|error| error.to_string())?;
        }
    }

    tray::relabel(&app, &labels).map_err(|error| error.to_string())
}

/// The event every window follows the language by (`i18n-provider.tsx`).
const LOCALE_EVENT: &str = "settings://locale";

/// The language the main window speaks, for the windows that cannot read the
/// store. `None` until it has spoken.
#[tauri::command]
pub(crate) fn app_locale(app: AppHandle) -> Option<String> {
    current(&app).locale
}
