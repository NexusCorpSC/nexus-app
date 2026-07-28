//! Startup and runtime diagnostics.
//!
//! Release builds are linked with `windows_subsystem = "windows"`, so there is
//! no console attached and `eprintln!` goes nowhere: a failure at startup shows
//! up as the app simply not opening, with nothing to go on. Everything worth
//! reporting is therefore appended to a file next to the app's data.

use std::fmt::Display;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

use tauri::{Manager, Runtime};

const LOG_FILE: &str = "nexus-app.log";

fn log_path<R: Runtime, M: Manager<R>>(manager: &M) -> Option<PathBuf> {
    let dir = manager
        .path()
        .app_log_dir()
        .or_else(|_| manager.path().app_data_dir())
        .ok()?;

    std::fs::create_dir_all(&dir).ok()?;

    Some(dir.join(LOG_FILE))
}

/// Appends a line to the log file, and mirrors it to stderr for `tauri dev`.
pub fn log<R: Runtime, M: Manager<R>>(manager: &M, message: impl Display) {
    eprintln!("{message}");

    let Some(path) = log_path(manager) else {
        return;
    };

    // Best effort: a diagnostic that cannot be written must not itself become a
    // failure. Nothing downstream reacts to this, so there is no error to hand
    // back to.
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{message}");
    }
}
