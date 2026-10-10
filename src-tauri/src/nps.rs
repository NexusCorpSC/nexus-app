//! The NPS — Nexus Positioning System: where the player is, from the game's
//! own `/showlocation`.
//!
//! Typed in the game's chat, `/showlocation` copies a line such as
//! `Coordinates: x:12850457093.000 y:0.000 z:0.000` to the clipboard: the
//! player's position in metres, in the frame of the star system. It is the
//! only position the game hands out — no memory is read, nothing is injected.
//!
//! The overlay's button puts `/showlocation` on the clipboard, so that pasting
//! it in the chat is all that is left to do; this then watches the clipboard
//! for the game's answer and carries it to the windows, stamped with the
//! moment it was seen. That moment matters: planets turn, and the overlay
//! needs it to undo the rotation (`src/lib/nps.ts`).
//!
//! Watched only while the NPS window is on screen: with it hidden, nobody's
//! copies are looked at. Polled rather than hooked, on the clipboard's
//! sequence number, which costs nothing to read.

use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use regex::Regex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::clipboard;
use crate::diagnostics::log;

/// Carries a [`Fix`] to every window.
pub(crate) const POSITION_EVENT: &str = "nps://position";

/// The window whose being on screen turns the watch on.
const NPS_WINDOW: &str = "nps";

/// What the game understands, put on the clipboard for the player to paste.
const SHOW_LOCATION: &str = "/showlocation";

/// A tenth of a second: on the equator of a large planet the ground moves a
/// few hundred metres a second, so the stamp has to be close to the copy.
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// One position read from the game.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Fix {
    /// Metres, in the frame of the star system.
    pub x: f64,
    pub y: f64,
    pub z: f64,
    /// When it was seen, in milliseconds since the Unix epoch.
    pub at: u64,
    /// Where it was read: `clipboard` for `/showlocation`, `screen` for
    /// `r_displayInfo` (`nps_screen.rs`).
    pub source: &'static str,
}

fn coordinates_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        let number = r"(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)";
        Regex::new(&format!(
            r"(?i)^\s*coordinates:\s*x:\s*{number}\s+y:\s*{number}\s+z:\s*{number}"
        ))
        .expect("the coordinates pattern is valid")
    })
}

/// The three coordinates of a `/showlocation` line, or `None` for anything
/// else that was copied.
pub fn parse(text: &str) -> Option<(f64, f64, f64)> {
    let captures = coordinates_pattern().captures(text)?;
    let value = |index: usize| captures.get(index)?.as_str().parse::<f64>().ok();
    let (x, y, z) = (value(1)?, value(2)?, value(3)?);
    [x, y, z].iter().all(|v| v.is_finite()).then_some((x, y, z))
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn watched(app: &AppHandle) -> bool {
    app.get_webview_window(NPS_WINDOW)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

/// Starts the watch, for the life of the app. Called once from `setup`.
pub(crate) fn install(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last = clipboard::sequence();
        loop {
            tokio::time::sleep(POLL_INTERVAL).await;

            let sequence = clipboard::sequence();
            if sequence == last {
                continue;
            }
            last = sequence;
            // Hidden, the copy is let go without being read — and it is not
            // picked up later either: a position minutes old would put the
            // player where the planet no longer is.
            if !watched(&app) {
                continue;
            }

            let at = now_ms();
            let Some(text) = clipboard::read_text() else {
                continue;
            };
            let Some((x, y, z)) = parse(&text) else {
                continue;
            };

            log(format!("nps: position read ({x:.0}, {y:.0}, {z:.0})"));
            if let Err(error) = app.emit(
                POSITION_EVENT,
                Fix {
                    x,
                    y,
                    z,
                    at,
                    source: "clipboard",
                },
            ) {
                log(format!("nps: cannot send the position: {error}"));
            }
        }
    });
}

/// Puts `/showlocation` on the clipboard: the player pastes it in the chat,
/// and the game answers on the same clipboard.
#[tauri::command]
pub fn nps_copy_command() -> Result<(), String> {
    clipboard::write_text(SHOW_LOCATION)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_game_line() {
        assert_eq!(
            parse("Coordinates: x:-18930539540.392 y:-2610440830.140 z:0.000"),
            Some((-18930539540.392, -2610440830.14, 0.0))
        );
    }

    #[test]
    fn tolerates_spacing_case_and_what_follows() {
        assert_eq!(
            parse("  coordinates:  x: 12 y: -3.5  z: 1e3\r\n"),
            Some((12.0, -3.5, 1000.0))
        );
    }

    #[test]
    fn ignores_anything_else() {
        assert_eq!(parse("/showlocation"), None);
        assert_eq!(parse("Coordinates: x:abc y:1 z:2"), None);
        assert_eq!(parse("x:1 y:2 z:3"), None);
    }
}
