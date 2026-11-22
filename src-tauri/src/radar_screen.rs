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

/// Readings in a row that find a number without confirming it, before the
/// box is said unreadable.
#[cfg(windows)]
const MAX_UNCONFIRMED: u32 = 3;

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

fn grouped_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        // A whole word of groups of three after the first, split by what the
        // game or the OCR puts between thousands: `12,680`, `12.680`.
        Regex::new(r"^\d{1,3}(?:[,.'\u{a0}\u{202f}]\d{3})+$").expect("the grouped pattern is valid")
    })
}

/// What the OCR takes for a digit.
fn as_digit(c: char) -> Option<char> {
    match c {
        '0'..='9' => Some(c),
        'O' | 'o' | 'D' | 'Q' => Some('0'),
        'I' | 'i' | 'l' | '|' | '!' => Some('1'),
        'S' | 's' => Some('5'),
        'B' => Some('8'),
        'Z' | 'z' => Some('2'),
        _ => None,
    }
}

fn is_separator(c: char) -> bool {
    matches!(c, ',' | '.' | '\'' | '\u{a0}' | '\u{202f}')
}

/// One word of the text read, once the OCR's mix-ups are undone.
#[derive(Clone, Debug, PartialEq)]
enum Word {
    /// Digits only, with their thousands separators gone; `grouped` when
    /// there were some.
    Number { digits: String, grouped: bool },
    /// A distance (`450m`, `1.2km`): never the signature.
    Distance,
    /// Anything else, a decimal number included.
    Other,
}

fn is_unit(word: &str) -> bool {
    matches!(word.to_lowercase().as_str(), "m" | "km")
}

/// Reads one word: a label glued in front (`RS8600`) is dropped, a unit
/// glued behind makes it a distance, and only then are the letters taken
/// for digits turned back into them (`I2,68O` is `12,680`).
fn word(raw: &str) -> Word {
    // Punctuation around the word (`(8,600)`, `8,600.`), but not the bars
    // and bangs the OCR reads for ones.
    let raw = raw.trim_matches(|c: char| !c.is_alphanumeric() && c != '|' && c != '!');
    if !raw.chars().any(|c| c.is_ascii_digit()) {
        return Word::Other;
    }

    let chars: Vec<char> = raw.chars().collect();
    // A run of letters in front is a label as soon as one of them cannot be
    // a digit: the `R` of `RS` says the `S` is no 5.
    let lead = chars.iter().take_while(|c| c.is_alphabetic()).count();
    let body_start = if chars[..lead].iter().any(|&c| as_digit(c).is_none()) {
        lead
    } else {
        0
    };
    // `RS:8600`: the colon after the label goes with it.
    let body_start = body_start
        + chars[body_start..]
            .iter()
            .take_while(|&&c| !c.is_alphanumeric() && c != '|' && c != '!')
            .count();
    let trail = chars[body_start..]
        .iter()
        .rev()
        .take_while(|c| c.is_alphabetic())
        .count();
    let body_end = chars.len() - trail;
    let tail: String = chars[body_end..].iter().collect();
    if is_unit(&tail) {
        return Word::Distance;
    }
    let body_end = if chars[body_end..].iter().any(|&c| as_digit(c).is_none()) {
        body_end
    } else {
        chars.len()
    };

    let mut body = String::new();
    for &c in &chars[body_start..body_end] {
        if is_separator(c) {
            body.push(c);
        } else if let Some(digit) = as_digit(c) {
            body.push(digit);
        } else {
            return Word::Other;
        }
    }

    if body.chars().all(|c| c.is_ascii_digit()) {
        return Word::Number {
            digits: body,
            grouped: false,
        };
    }
    if grouped_pattern().is_match(&body) {
        return Word::Number {
            digits: body.chars().filter(char::is_ascii_digit).collect(),
            grouped: true,
        };
    }
    // `1.2`, `12,5`: a decimal, which a signature never is.
    Word::Other
}

/// A number found in the text, and whether it took a space between
/// thousands to make it: `12 680` is likelier two numbers than `12680` is.
struct Candidate {
    digits: String,
    spaced: bool,
}

fn candidates(line: &str) -> Vec<Candidate> {
    let raw: Vec<&str> = line.split_whitespace().collect();
    let mut words: Vec<Word> = raw.iter().map(|w| word(w)).collect();
    // A number followed by its unit is a distance: `1.250 km`, `450 m`.
    for index in 0..words.len() {
        if index + 1 < raw.len() && is_unit(raw[index + 1]) {
            if let Word::Number { .. } = words[index] {
                words[index] = Word::Distance;
            }
        }
    }

    let mut found = Vec::new();
    let mut index = 0;
    while index < words.len() {
        let Word::Number { digits, grouped } = &words[index] else {
            index += 1;
            continue;
        };
        let mut joined = digits.clone();
        let mut next = index + 1;
        // Thousands split by spaces: a short head, then words of exactly
        // three digits.
        if !grouped && digits.len() <= 3 {
            while let Some(Word::Number {
                digits: group,
                grouped: false,
            }) = words.get(next)
            {
                if group.len() != 3 {
                    break;
                }
                joined.push_str(group);
                next += 1;
            }
        }
        found.push(Candidate {
            spaced: next > index + 1,
            digits: joined,
        });
        index = next;
    }
    found
}

/// The signature in the text read in the box, within [`MIN_SIGNATURE`] and
/// [`MAX_SIGNATURE`]: a number written in one piece before one put together
/// from words split by spaces, then the longest, then the first.
pub fn signature(text: &str) -> Option<u32> {
    let mut best: Option<(bool, usize, u32)> = None;
    for line in text.lines() {
        for candidate in candidates(line) {
            let Ok(value) = candidate.digits.parse::<u32>() else {
                continue;
            };
            if !(MIN_SIGNATURE..=MAX_SIGNATURE).contains(&value) {
                continue;
            }
            let length = candidate.digits.len();
            let better = best.is_none_or(|(spaced, best_length, _)| {
                (spaced && !candidate.spaced)
                    || (spaced == candidate.spaced && length > best_length)
            });
            if better {
                best = Some((candidate.spaced, length, value));
            }
        }
    }
    best.map(|(_, _, value)| value)
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
        // The box the agreement was built on: another one starts it over.
        #[cfg(windows)]
        let mut watching: Option<Region> = None;
        // Readings in a row that found a number but could not confirm it.
        #[cfg(windows)]
        let mut unconfirmed = 0u32;
        loop {
            let settings = app.state::<Tracking>().get();
            #[cfg(windows)]
            let region = settings
                .region
                .filter(|_| settings.enabled && watched(&app));
            #[cfg(not(windows))]
            let region: Option<Region> = None;

            let Some(region) = region else {
                // Off or hidden: what was read before is no witness for what
                // comes after.
                #[cfg(windows)]
                {
                    agreement = Agreement::default();
                    watching = None;
                    unconfirmed = 0;
                }
                announce(&app, &mut last, Status::Idle);
                tokio::time::sleep(IDLE_INTERVAL).await;
                continue;
            };

            let interval = settings.interval_ms.clamp(MIN_INTERVAL_MS, MAX_INTERVAL_MS);
            let started = std::time::Instant::now();

            #[cfg(windows)]
            {
                if watching != Some(region) {
                    agreement = Agreement::default();
                    watching = Some(region);
                    unconfirmed = 0;
                }
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
                            unconfirmed = 0;
                            Status::Reading
                        }
                        // A number not confirmed yet still reads, for a
                        // moment: past a few readings that never agree, the
                        // box is as good as unreadable.
                        None if (plain.is_some() || inverted.is_some())
                            && last == Status::Reading
                            && unconfirmed < MAX_UNCONFIRMED =>
                        {
                            unconfirmed += 1;
                            Status::Reading
                        }
                        None => {
                            unconfirmed = 0;
                            Status::Unreadable
                        }
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
    fn a_glyph_glued_to_the_number_is_not_the_number() {
        // Found in review: the last three digits used to win.
        assert_eq!(signature("8,600»"), Some(8_600));
        assert_eq!(signature("(12,680)"), Some(12_680));
        assert_eq!(signature("12,680."), Some(12_680));
    }

    #[test]
    fn a_label_glued_in_front_is_dropped() {
        assert_eq!(signature("RS8600"), Some(8_600));
        assert_eq!(signature("RS:8,600"), Some(8_600));
        // All of it could be digits: `I` is a 1, `S` a 5.
        assert_eq!(signature("I2680"), Some(12_680));
        assert_eq!(signature("S100"), Some(5_100));
    }

    #[test]
    fn distances_are_never_the_signature() {
        assert_eq!(signature("12,680m"), None);
        assert_eq!(signature("1.250 km\n4300"), Some(4_300));
        assert_eq!(signature("450 m 3170"), Some(3_170));
        assert_eq!(signature("1.2km"), None);
    }

    #[test]
    fn a_number_in_one_piece_wins_over_spaced_words() {
        assert_eq!(signature("1 250 4300"), Some(4_300));
        assert_eq!(signature("12 680 45"), Some(12_680));
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
        assert_eq!(signature("12.5 3170"), Some(3_170));
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
