//! The few texts the native side shows on its own: the tray menu, and the
//! notifications it raises when a capture fails with no window of ours left
//! to say so.
//!
//! Translations live in the webview, with every other text of the app. It
//! hands these over when it starts and whenever the language changes; until
//! then the French ones below stand in, French being the app's fallback.

use std::sync::Mutex;

use serde::Deserialize;
use tauri::{AppHandle, Manager, State};

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
    pub quit: String,
    pub capture_failed: String,
    pub ocr_failed: String,
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
            quit: "Quitter Nexus App".into(),
            capture_failed: "Capture impossible".into(),
            ocr_failed: "Lecture du texte impossible".into(),
        }
    }
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
    *state.0.lock().map_err(|error| error.to_string())? = labels.clone();
    tray::relabel(&app, &labels).map_err(|error| error.to_string())
}
