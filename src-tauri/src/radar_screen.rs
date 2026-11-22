//! The radar signature scanner: the number the game's scan shows over a rock,
//! an asteroid or a wreck, read off the screen.
//!
//! The player draws a box once around where the scan writes the signature
//! (the calibration, through the capture window, as for the NPS). From then
//! on, while the scanner window is on screen, that box is grabbed and read
//! with the OS's OCR every second or so, and each signature found goes to the
//! scanner window, which compares it with the known ones (`src/lib/radar.ts`).
//!
//! Only pixels are read, as for the NPS: nothing touches the game.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::capture::Selection;
use crate::diagnostics::log;
use crate::nps_screen::Region;

/// The scanner's window.
pub(crate) const RADAR_WINDOW: &str = "radar";

/// Carries a [`Status`] to the scanner window, each time it changes.
const STATUS_EVENT: &str = "radar://status";

/// Carries a [`Calibrated`] to the scanner window once a box has been drawn.
const CALIBRATED_EVENT: &str = "radar://calibrated";

/// Carries a [`Reading`] to the scanner window.
#[cfg(windows)]
const READING_EVENT: &str = "radar://reading";

/// Bounds on the reading interval, as for the NPS.
const MIN_INTERVAL_MS: u64 = 250;
const MAX_INTERVAL_MS: u64 = 10_000;

/// The signatures worth reading: under it, a distance or a stray digit;
/// over it, twenty times the largest known signature and then some.
const MIN_SIGNATURE: u32 = 100;
const MAX_SIGNATURE: u32 = 2_000_000;

/// How long to wait, with the scanner off, before looking at the settings
/// again.
const IDLE_INTERVAL: Duration = Duration::from_millis(500);

/// What the scanner window asks for. It owns these settings and keeps them in
/// the store; this only holds the copy the loop reads.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub enabled: bool,
    pub interval_ms: u64,
    pub region: Option<Region>,
}

/// How the reading goes, for the scanner window to say.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum Status {
    /// Off, not calibrated, or the window is hidden.
    Idle,
    /// The last reading found a signature.
    Reading,
    /// The box was read, but no signature in it: nothing scanned, or
    /// something covers it.
    Unreadable,
    /// The screen could not be grabbed or read at all.
    Failed { message: String },
}

/// A signature read, and when.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    pub value: u32,
    pub at: u64,
}

/// What came of a calibration.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Calibrated {
    /// `None` when the box drawn was too small to keep.
    pub region: Option<Region>,
    /// The signature read in the box straight away, if any.
    pub value: Option<u32>,
}

#[derive(Default)]
pub struct Tracking(Mutex<Settings>);

impl Tracking {
    fn get(&self) -> Settings {
        self.0.lock().map(|s| s.clone()).unwrap_or_default()
    }

    fn set_region(&self, region: Region) {
        if let Ok(mut settings) = self.0.lock() {
            settings.region = Some(region);
        }
    }
}

/// Applies the settings chosen in the scanner window.
#[tauri::command]
pub fn radar_screen_configure(app: AppHandle, settings: Settings) {
    if let Ok(mut current) = app.state::<Tracking>().0.lock() {
        *current = settings;
    }
}

fn number_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        // Groups of three after the first, split by whatever the game or the
        // OCR puts between thousands — `12,680`, `12 680`, `12.680` — or
        // digits in one run.
        Regex::new(r"\d{1,3}(?:[ ,.\u{a0}\u{202f}']\d{3})+\b|\d+")
            .expect("the number pattern is valid")
    })
}

/// A word with the letters the OCR takes for digits turned back into them,
/// when it is mostly digits already: `I2,68O` is `12,680`, but `RS` stays.
fn undo_mix_ups(word: &str) -> String {
    let digits = word.chars().filter(char::is_ascii_digit).count();
    let letters = word.chars().filter(|c| c.is_alphabetic()).count();
    if digits == 0 || letters > digits {
        return word.to_string();
    }
    word.chars()
        .map(|c| match c {
            'O' | 'o' | 'D' | 'Q' => '0',
            'I' | 'i' | 'l' | '|' | '!' => '1',
            'S' | 's' => '5',
            'B' => '8',
            'Z' | 'z' => '2',
            other => other,
        })
        .collect()
}

/// The signature in the text read in the box: the longest number in it, the
/// first one when two are as long, within [`MIN_SIGNATURE`] and
/// [`MAX_SIGNATURE`].
pub fn signature(text: &str) -> Option<u32> {
    let cleaned: String = text
        .split_inclusive(char::is_whitespace)
        .map(|word| {
            let trimmed = word.trim_end();
            let mut fixed = undo_mix_ups(trimmed);
            fixed.push_str(&word[trimmed.len()..]);
            fixed
        })
        .collect();

    let mut best: Option<(usize, u32)> = None;
    for line in cleaned.lines() {
        for found in number_pattern().find_iter(line) {
            let digits: String = found
                .as_str()
                .chars()
                .filter(char::is_ascii_digit)
                .collect();
            let Ok(value) = digits.parse::<u32>() else {
                continue;
            };
            if !(MIN_SIGNATURE..=MAX_SIGNATURE).contains(&value) {
                continue;
            }
            if best.is_none_or(|(length, _)| digits.len() > length) {
                best = Some((digits.len(), value));
            }
        }
    }
    best.map(|(_, value)| value)
}

/// Keeps the signatures two readings agree on: the box read as it is and
/// inverted, or, when only one of them finds a number, that one and the
/// reading before. One reading alone may have taken a 6 for an 8.
#[derive(Default)]
pub struct Agreement {
    single: Option<u32>,
}

impl Agreement {
    pub fn accept(&mut self, plain: Option<u32>, inverted: Option<u32>) -> Option<u32> {
        match (plain, inverted) {
            (Some(a), Some(b)) if a == b => {
                self.single = None;
                Some(a)
            }
            (Some(a), None) | (None, Some(a)) => {
                let confirmed = self.single == Some(a);
                self.single = Some(a);
                confirmed.then_some(a)
            }
            // Two readings that disagree: neither is trusted, and neither
            // confirms the next.
            (Some(_), Some(_)) => {
                self.single = None;
                None
            }
            (None, None) => {
                self.single = None;
                None
            }
        }
    }
}

#[cfg(windows)]
async fn read_both(image: xcap::image::RgbaImage) -> Result<(Option<u32>, Option<u32>), String> {
    let (plain, inverted) = crate::capture::read_both_ways(image).await?;
    Ok((signature(&plain), signature(&inverted)))
}

/// Records the box just drawn in the capture window, tries it on the frozen
/// screen, and hands both back to the scanner window.
pub(crate) async fn calibrate(
    app: &AppHandle,
    frame: crate::capture::Capture,
    selection: Selection,
) -> Result<(), String> {
    let region = Region {
        monitor_x: frame.monitor.x,
        monitor_y: frame.monitor.y,
        selection,
    };

    #[cfg(windows)]
    let crop = frame.crop(selection);
    #[cfg(not(windows))]
    let crop: Result<(), String> = Err("not on Windows".to_string());

    let calibrated = match crop {
        Err(error) => {
            log(format!("radar: calibration box refused: {error}"));
            Calibrated {
                region: None,
                value: None,
            }
        }
        #[cfg_attr(not(windows), allow(unused_variables))]
        Ok(image) => {
            // On the frozen screen, one reading is all there is: either way
            // of reading it will do.
            #[cfg(windows)]
            let value = match read_both(image).await {
                Ok((plain, inverted)) => plain.or(inverted),
                Err(error) => {
                    log(format!("radar: cannot read the calibrated box: {error}"));
                    None
                }
            };
            #[cfg(not(windows))]
            let value = None;
            app.state::<Tracking>().set_region(region);
            Calibrated {
                region: Some(region),
                value,
            }
        }
    };

    app.emit_to(RADAR_WINDOW, CALIBRATED_EVENT, calibrated)
        .map_err(|e| e.to_string())
}

fn announce(app: &AppHandle, last: &mut Status, status: Status) {
    if *last == status {
        return;
    }
    if let Status::Failed { message } = &status {
        log(format!("radar: cannot read the screen: {message}"));
    }
    *last = status.clone();
    if let Err(error) = app.emit_to(RADAR_WINDOW, STATUS_EVENT, status) {
        log(format!("radar: cannot send the status: {error}"));
    }
}

#[cfg(windows)]
fn watched(app: &AppHandle) -> bool {
    app.get_webview_window(RADAR_WINDOW)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

/// Starts the reading loop, for the life of the app. Called once from `setup`.
pub(crate) fn install(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last = Status::Idle;
        #[cfg(windows)]
        let mut agreement = Agreement::default();
        loop {
            let settings = app.state::<Tracking>().get();
            #[cfg(windows)]
            let region = settings
                .region
                .filter(|_| settings.enabled && watched(&app));
            #[cfg(not(windows))]
            let region: Option<Region> = None;

            let Some(region) = region else {
                announce(&app, &mut last, Status::Idle);
                tokio::time::sleep(IDLE_INTERVAL).await;
                continue;
            };

            let interval = settings.interval_ms.clamp(MIN_INTERVAL_MS, MAX_INTERVAL_MS);
            let started = std::time::Instant::now();

            #[cfg(windows)]
            {
                let status = match read_once(region).await {
                    Ok((plain, inverted)) => match agreement.accept(plain, inverted) {
                        Some(value) => {
                            let reading = Reading {
                                value,
                                at: crate::nps::now_ms(),
                            };
                            if let Err(error) = app.emit_to(RADAR_WINDOW, READING_EVENT, reading) {
                                log(format!("radar: cannot send the reading: {error}"));
                            }
                            Status::Reading
                        }
                        // A number not confirmed yet is still a box that
                        // reads: only an empty one is unreadable.
                        None if plain.is_some() || inverted.is_some() => last.clone(),
                        None => Status::Unreadable,
                    },
                    Err(message) => Status::Failed { message },
                };
                announce(&app, &mut last, status);
            }
            #[cfg(not(windows))]
            let _ = region;

            let rest = Duration::from_millis(interval).saturating_sub(started.elapsed());
            tokio::time::sleep(rest).await;
        }
    });
}

#[cfg(windows)]
async fn read_once(region: Region) -> Result<(Option<u32>, Option<u32>), String> {
    let image = tauri::async_runtime::spawn_blocking(move || {
        crate::capture::grab_region((region.monitor_x, region.monitor_y), region.selection)
    })
    .await
    .map_err(|e| e.to_string())??;

    read_both(image).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_plain_numbers() {
        assert_eq!(signature("12680"), Some(12_680));
        assert_eq!(signature("3170\n"), Some(3_170));
    }

    #[test]
    fn reads_thousands_separators() {
        assert_eq!(signature("12,680"), Some(12_680));
        assert_eq!(signature("12 680"), Some(12_680));
        assert_eq!(signature("12.680"), Some(12_680));
        assert_eq!(signature("1,234,567"), Some(1_234_567));
        assert_eq!(signature("12\u{a0}680"), Some(12_680));
    }

    #[test]
    fn undoes_the_ocr_mix_ups() {
        assert_eq!(signature("I2,68O"), Some(12_680));
        assert_eq!(signature("43OO"), Some(4_300));
        assert_eq!(signature("3l85"), Some(3_185));
    }

    #[test]
    fn keeps_words_as_they_are() {
        // `RS` is no number, and the signature next to it still reads.
        assert_eq!(signature("RS: 8,600"), Some(8_600));
        assert_eq!(signature("SIGNAL"), None);
    }

    #[test]
    fn takes_the_longest_number() {
        // A distance in metres next to the signature.
        assert_eq!(signature("45m\n12,680"), Some(12_680));
        assert_eq!(signature("1.2 km 4300"), Some(4_300));
    }

    #[test]
    fn ignores_what_cannot_be_a_signature() {
        assert_eq!(signature(""), None);
        assert_eq!(signature("42"), None);
        assert_eq!(signature("99999999"), None);
    }

    #[test]
    fn two_readings_must_agree() {
        let mut agreement = Agreement::default();
        assert_eq!(agreement.accept(Some(4300), Some(4300)), Some(4300));
        assert_eq!(agreement.accept(Some(4300), Some(4800)), None);
        // One reading alone waits for the next…
        assert_eq!(agreement.accept(Some(8600), None), None);
        assert_eq!(agreement.accept(None, Some(8600)), Some(8600));
        // …and a different one starts over.
        assert_eq!(agreement.accept(Some(3170), None), None);
        assert_eq!(agreement.accept(Some(3185), None), None);
        assert_eq!(agreement.accept(None, None), None);
        assert_eq!(agreement.accept(Some(3185), None), None);
    }
}
