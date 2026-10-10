//! The NPS, followed live: the player's position read off the screen.
//!
//! With `r_displayInfo 1` typed in its console, the game writes a few debug
//! lines in the top-right corner of the screen, among them
//! `Zone: SolarSystem_862943812119 Pos: 16729220.4026km -19942047.4831km
//! 2239.7445km` — the player's position in the frame of the star system, the
//! same one `/showlocation` gives, in kilometres. The player draws a box
//! around those lines once (the calibration, through the capture window);
//! from then on, while the NPS window is on screen, that box is grabbed and
//! read with the OS's OCR every second or so, and each position found goes
//! out as `/showlocation`'s would (`nps.rs`).
//!
//! Only pixels are read, as for the region capture: nothing touches the game.
//! `/showlocation` stays the way in when the debug lines are off or unreadable.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::capture::Selection;
use crate::diagnostics::log;
#[cfg(windows)]
use crate::nps::{now_ms, watched, Fix, POSITION_EVENT};

/// Carries a [`Status`] to the windows, each time it changes.
const STATUS_EVENT: &str = "nps://screen-status";

/// Carries a [`Calibrated`] to the NPS window once a box has been drawn.
const CALIBRATED_EVENT: &str = "nps://calibrated";

/// The window the calibration hands back to.
const NPS_WINDOW: &str = "nps";

/// Bounds on the reading interval: under a quarter of a second the OCR runs
/// back to back for nothing, past ten it is no longer following anyone.
const MIN_INTERVAL_MS: u64 = 250;
const MAX_INTERVAL_MS: u64 = 10_000;

/// How long to wait, with the tracking off, before looking at the settings
/// again.
const IDLE_INTERVAL: Duration = Duration::from_millis(500);

/// Where the debug lines are on screen: a box on one monitor, as fractions of
/// it, so that it survives a change of DPI scaling.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Region {
    /// The monitor's top-left corner on the virtual desktop: what finds it
    /// again.
    pub monitor_x: i32,
    pub monitor_y: i32,
    pub selection: Selection,
}

/// What the NPS window asks for. It owns these settings and keeps them in the
/// store; this only holds the copy the loop reads.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub enabled: bool,
    pub interval_ms: u64,
    pub region: Option<Region>,
}

/// How the reading goes, for the NPS window to say.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum Status {
    /// Off, not calibrated, or the window is hidden.
    Idle,
    /// The last reading found a position.
    Reading,
    /// The box was read, but no position in it: the debug lines are off, or
    /// something covers them.
    Unreadable,
    /// The screen could not be grabbed or read at all.
    Failed { message: String },
}

/// What came of a calibration.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Calibrated {
    pub region: Region,
    /// Whether a position could be read in the box straight away.
    pub found: bool,
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

/// Applies the settings chosen in the NPS window.
#[tauri::command]
pub fn nps_screen_configure(app: AppHandle, settings: Settings) {
    if let Ok(mut current) = app.state::<Tracking>().0.lock() {
        *current = settings;
    }
}

fn pos_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        // `CamPos` lower down has no word break before its `Pos`.
        Regex::new(r"(?i)^(.*?)\bP[o0]s\b\s*[:;.]?(.*)$").expect("the pos pattern is valid")
    })
}

fn distance_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        // Digits and the letters the OCR takes them for; always with
        // decimals, as the game writes them, which keeps stray words out.
        let digits = r"[0-9OoDQIil|!]";
        Regex::new(&format!(r"(?i)(-?)\s*({digits}+\.{digits}+)\s*(km|m)\b"))
            .expect("the distance pattern is valid")
    })
}

/// A zone name with the OCR's usual mix-ups undone, letters only:
/// `SolarSystem_862943812119` and `So1arSystem 8629…` both come out
/// `solarsystem…`.
fn zone_key(zone: &str) -> String {
    zone.chars()
        .map(|c| match c {
            '0' => 'o',
            '1' => 'l',
            '5' => 's',
            other => other.to_ascii_lowercase(),
        })
        .filter(char::is_ascii_lowercase)
        .collect()
}

/// The three coordinates after a `Pos:`, in metres.
fn coordinates(text: &str) -> Option<(f64, f64, f64)> {
    let text = text.replace(['–', '—', '−'], "-").replace(',', ".");
    let mut values = distance_pattern().captures_iter(&text).map(|captures| {
        let number: String = captures[2]
            .chars()
            .map(|c| match c {
                'O' | 'o' | 'D' | 'Q' => '0',
                'I' | 'i' | 'l' | '|' | '!' => '1',
                other => other,
            })
            .collect();
        let value = number.parse::<f64>().ok()?;
        let value = if captures[3].eq_ignore_ascii_case("km") {
            value * 1_000.0
        } else {
            value
        };
        let value = if captures[1].is_empty() {
            value
        } else {
            -value
        };
        value.is_finite().then_some(value)
    });
    let (x, y, z) = (values.next()??, values.next()??, values.next()??);
    Some((x, y, z))
}

/// The player's position in the frame of the star system, in metres, from
/// the text read in the box, or `None` when it is not there.
///
/// The `SolarSystem` line is the one: it is in the frame `/showlocation`
/// uses. The `Root` line, the same numbers in Stanton, stands in for it when
/// it could not be read.
pub fn parse(text: &str) -> Option<(f64, f64, f64)> {
    let mut root = None;
    for line in text.lines() {
        let Some(captures) = pos_pattern().captures(line) else {
            continue;
        };
        let zone = zone_key(&captures[1]);
        let Some(position) = coordinates(&captures[2]) else {
            continue;
        };
        if zone.contains("solarsystem") {
            return Some(position);
        }
        if zone.contains("root") && root.is_none() {
            root = Some(position);
        }
    }
    root
}

#[cfg(windows)]
async fn read_coordinates(
    image: xcap::image::RgbaImage,
) -> Result<Option<(f64, f64, f64)>, String> {
    // Light text over the game: read as it is first, then greyed and
    // inverted, which is what the engine reads best when the scene behind is
    // bright.
    let text = crate::capture::read_region(image.clone(), false).await?;
    if let Some(position) = parse(&text) {
        return Ok(Some(position));
    }
    let text = crate::capture::read_region(image, true).await?;
    Ok(parse(&text))
}

/// Records the box just drawn in the capture window, tries it on the frozen
/// screen, and hands both back to the NPS window.
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
    let found = match read_coordinates(frame.crop(selection)?).await {
        Ok(found) => found.is_some(),
        Err(error) => {
            log(format!("nps: cannot read the calibrated box: {error}"));
            false
        }
    };
    #[cfg(not(windows))]
    let found = false;

    app.state::<Tracking>().set_region(region);
    app.emit_to(NPS_WINDOW, CALIBRATED_EVENT, Calibrated { region, found })
        .map_err(|e| e.to_string())
}

fn announce(app: &AppHandle, last: &mut Status, status: Status) {
    if *last == status {
        return;
    }
    if let Status::Failed { message } = &status {
        log(format!("nps: cannot read the screen: {message}"));
    }
    *last = status.clone();
    if let Err(error) = app.emit(STATUS_EVENT, status) {
        log(format!("nps: cannot send the screen status: {error}"));
    }
}

/// Starts the reading loop, for the life of the app. Called once from `setup`.
pub(crate) fn install(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last = Status::Idle;
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
                    Ok(Some(fix)) => {
                        if let Err(error) = app.emit(POSITION_EVENT, fix) {
                            log(format!("nps: cannot send the position: {error}"));
                        }
                        Status::Reading
                    }
                    Ok(None) => Status::Unreadable,
                    Err(message) => Status::Failed { message },
                };
                announce(&app, &mut last, status);
            }
            #[cfg(not(windows))]
            let _ = region;

            // The interval runs from one reading to the next, the OCR's own
            // time included.
            let rest = Duration::from_millis(interval).saturating_sub(started.elapsed());
            tokio::time::sleep(rest).await;
        }
    });
}

#[cfg(windows)]
async fn read_once(region: Region) -> Result<Option<Fix>, String> {
    let at = now_ms();
    let image = tauri::async_runtime::spawn_blocking(move || {
        crate::capture::grab_region((region.monitor_x, region.monitor_y), region.selection)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(read_coordinates(image).await?.map(|(x, y, z)| Fix {
        x,
        y,
        z,
        at,
        source: "screen",
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DISPLAY_INFO: &str = "\
Zone: Hangar_MediumFront_RestStop_868650250231 Pos: 3.05m -126.68m 7.96m
Zone: OOC_Stanton3_L1 Pos: 85.7653km -5040.5582km 2231.6679km
Zone: SolarSystem_862943812119 Pos: 16729220.4026km -19942047.4831km 2239.7445km
Zone: Root Pos: 16729220.4026km -19942047.4831km 2239.7445km
FPS 60.0 - 16.7ms [8.9ms]";

    fn close(a: (f64, f64, f64), b: (f64, f64, f64)) -> bool {
        (a.0 - b.0).abs() < 0.01 && (a.1 - b.1).abs() < 0.01 && (a.2 - b.2).abs() < 0.01
    }

    #[test]
    fn reads_the_solar_system_line_in_metres() {
        let position = parse(DISPLAY_INFO).unwrap();
        assert!(close(
            position,
            (16_729_220_402.6, -19_942_047_483.1, 2_239_744.5)
        ));
    }

    #[test]
    fn undoes_the_ocr_mix_ups() {
        // As Tesseract read the capture: an `i` for a `1`, a comma for the
        // point, underscores lost, and the `Root` line in pieces.
        let text = "\
Zone: Hangar MediumFront RestStop 868650250231 Pos: 3.05m -126.68m 7.96m
Zone: OOC Stanton3 Ll Pos: 85.7653km -5040.5582km 2231.6679km
Zone: SolarSystem 862943812119 Pos: 16729220.4026km -19942047.483ikm 2239,7445km
Zone: Root Pos: 16729220.4026km ee applet 239.7445km";
        let position = parse(text).unwrap();
        assert!(close(
            position,
            (16_729_220_402.6, -19_942_047_483.1, 2_239_744.5)
        ));
    }

    #[test]
    fn falls_back_on_the_root_line() {
        let text = "Zone: So1arSystem Pos: garbled\nZone: Root Pos: 1.5km -2.25km 3.0m";
        assert!(close(parse(text).unwrap(), (1_500.0, -2_250.0, 3.0)));
    }

    #[test]
    fn ignores_the_other_zones_and_lines() {
        assert_eq!(
            parse("Zone: OOC_Stanton3_L1 Pos: 85.7653km -5040.5582km 2231.6679km"),
            None
        );
        assert_eq!(
            parse("CamPos Planet Zone: -2838466287.686626 -529572863.560040"),
            None
        );
        assert_eq!(parse("FPS 60.0 - 16.7ms [8.9ms]"), None);
        assert_eq!(parse(""), None);
    }

    #[test]
    fn needs_three_values() {
        assert_eq!(parse("Zone: SolarSystem_1 Pos: 1.0km 2.0km"), None);
    }
}
