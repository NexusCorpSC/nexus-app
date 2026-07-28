//! Startup and runtime diagnostics.
//!
//! Release builds are linked with `windows_subsystem = "windows"`, so there is
//! no console attached and `eprintln!` goes nowhere: a failure at startup shows
//! up as the app simply not opening, with nothing to go on. Everything worth
//! reporting is therefore appended to a file next to the app's data.

use std::backtrace::Backtrace;
use std::fmt::Display;
use std::fs::OpenOptions;
use std::io::Write;
use std::panic;
use std::path::PathBuf;
use std::sync::RwLock;

use tauri::{Manager, Runtime};

const LOG_FILE: &str = "nexus-app.log";

/// Mirrors `identifier` in `tauri.conf.json`. Tauri derives the app data
/// directory from it, and this is the only way to find that directory before
/// the app exists — which is precisely when a crash is hardest to diagnose.
const IDENTIFIER: &str = "services.nexus.app";

/// Filled by [`init`] once Tauri can be asked for the real directory. Until
/// then, and if anything goes wrong, [`default_log_dir`] answers instead.
static LOG_DIR: RwLock<Option<PathBuf>> = RwLock::new(None);

/// Points the log at the directory Tauri hands out, once the app is built.
pub fn init<R: Runtime, M: Manager<R>>(manager: &M) {
    let dir = manager
        .path()
        .app_log_dir()
        // Not every platform hands out a log dir. Fall back to the app data,
        // keeping the `logs/` level so the file stays where the README sends
        // whoever is trying to diagnose a start-up that produced no window.
        .or_else(|_| manager.path().app_data_dir().map(|dir| dir.join("logs")))
        .ok();

    if let (Some(dir), Ok(mut slot)) = (dir, LOG_DIR.write()) {
        *slot = Some(dir);
    }
}

/// Where diagnostics land before [`init`] has run.
fn default_log_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("LOCALAPPDATA")
            .map(|base| PathBuf::from(base).join(IDENTIFIER).join("logs"))
    }

    #[cfg(not(windows))]
    {
        Some(std::env::temp_dir().join(IDENTIFIER))
    }
}

fn log_path() -> Option<PathBuf> {
    // `try_read` rather than `read`: this runs from the panic hook too, and a
    // panic raised while the lock is held must not turn into a deadlock.
    let configured = LOG_DIR.try_read().ok().and_then(|slot| slot.clone());
    let dir = configured.or_else(default_log_dir)?;

    std::fs::create_dir_all(&dir).ok()?;

    Some(dir.join(LOG_FILE))
}

/// Appends a line to the log file, and mirrors it to stderr for `tauri dev`.
pub fn log(message: impl Display) {
    eprintln!("{message}");

    let Some(path) = log_path() else {
        return;
    };

    // Best effort: a diagnostic that cannot be written must not itself become a
    // failure. Nothing downstream reacts to this, so there is no error to hand
    // back to.
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{message}");
    }
}

/// Records panics in the log file before the process goes down.
///
/// A panic raised on the thread pumping the message loop — a command handler, a
/// window event, a global shortcut — cannot unwind through the system frames
/// below it, so the runtime aborts on the spot. Nothing is printed anywhere a
/// packaged build can show it, and all that is left behind is a minidump.
/// Writing the message, its location and a backtrace here turns that into a log
/// line.
///
/// Installed before `tauri::Builder`, so panics raised while the app is still
/// being built are covered too.
pub fn install_panic_logger() {
    let previous = panic::take_hook();

    panic::set_hook(Box::new(move |info| {
        let payload = info.payload();
        let message = payload
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
            .unwrap_or("panic without a message");

        let thread = std::thread::current();
        let thread = thread.name().unwrap_or("unnamed").to_string();

        let location = info
            .location()
            .map(|at| format!("{}:{}:{}", at.file(), at.line(), at.column()))
            .unwrap_or_else(|| "unknown location".to_string());

        log(format!(
            "panic on thread `{thread}` at {location}: {message}\n{}",
            Backtrace::force_capture()
        ));

        previous(info);
    }));
}
