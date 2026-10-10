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

/// Two readings of the same line agree when no axis differs by more than this,
/// in metres: the game writes tenths of a metre.
const AGREE_M: f64 = 1.0;

/// Faster than this, in metres a second, a move is taken for a misread digit
/// until the next reading confirms it: no ship goes that fast out of quantum
/// travel, and a wrong digit in the kilometres jumps further.
const MAX_SPEED: f64 = 5_000.0;

/// Allowance on top of [`MAX_SPEED`], in metres, for readings close in time.
const JUMP_MARGIN_M: f64 = 50.0;

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

type Position = (f64, f64, f64);

/// The two lines that carry the position, as read in the box.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Lines {
    /// `Zone: SolarSystem_… Pos:`, in the frame `/showlocation` uses.
    pub solar: Option<Position>,
    /// `Zone: Root Pos:`: the same numbers in Stanton, not in Pyro.
    pub root: Option<Position>,
}

/// The position lines found in the text read in the box, in metres.
pub fn lines(text: &str) -> Lines {
    let mut found = Lines::default();
    for line in text.lines() {
        let Some(captures) = pos_pattern().captures(line) else {
            continue;
        };
        let zone = zone_key(&captures[1]);
        let Some(position) = coordinates(&captures[2]) else {
            continue;
        };
        if zone.contains("solarsystem") && found.solar.is_none() {
            found.solar = Some(position);
        } else if zone.contains("root") && found.root.is_none() {
            found.root = Some(position);
        }
    }
    found
}

fn same(a: Position, b: Position) -> bool {
    (a.0 - b.0).abs() <= AGREE_M && (a.1 - b.1).abs() <= AGREE_M && (a.2 - b.2).abs() <= AGREE_M
}

/// The position two independent readings agree on, or `None`.
///
/// The OCR mistakes a digit for another now and then — a 2 read as a 9 — and
/// one reading alone cannot tell. So the box is read twice, as it is and
/// inverted, and a position counts once two readings give it: the
/// `SolarSystem` line of both, or that line and the `Root` line, which carry
/// the same numbers in Stanton. The same mistake twice, on two different
/// images or on two different lines, is rare enough.
pub fn agreed(plain: Lines, inverted: Lines) -> Option<Position> {
    let solars = [plain.solar, inverted.solar];
    let roots = [plain.root, inverted.root];
    for (index, solar) in solars.iter().enumerate() {
        let Some(solar) = *solar else { continue };
        let other = solars[1 - index];
        let witnesses = std::iter::once(other).chain(roots).flatten();
        if witnesses.into_iter().any(|witness| same(solar, witness)) {
            return Some(solar);
        }
    }
    // No `SolarSystem` line confirmed: both `Root` lines, then.
    match roots {
        [Some(a), Some(b)] if solars == [None, None] && same(a, b) => Some(a),
        _ => None,
    }
}

/// Keeps the readings that agree with the way the player moves: a jump no
/// ship can make is held back until the next reading lands next to it — the
/// end of a quantum travel, a respawn — and dropped otherwise, as the
/// misread it most likely was.
#[derive(Default)]
pub struct Motion {
    last: Option<(Position, u64)>,
    pending: Option<(Position, u64)>,
}

fn reachable(from: (Position, u64), to: (Position, u64)) -> bool {
    let ((a, from_at), (b, to_at)) = (from, to);
    let seconds = to_at.saturating_sub(from_at) as f64 / 1_000.0;
    let distance = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2) + (b.2 - a.2).powi(2)).sqrt();
    distance <= MAX_SPEED * seconds + JUMP_MARGIN_M
}

impl Motion {
    /// Whether the reading is to be passed on.
    pub fn accept(&mut self, position: Position, at: u64) -> bool {
        let reading = (position, at);
        let accepted = match (self.last, self.pending) {
            (None, _) => true,
            (Some(last), _) if reachable(last, reading) => true,
            (_, Some(pending)) => reachable(pending, reading),
            _ => false,
        };
        if accepted {
            self.last = Some(reading);
            self.pending = None;
        } else {
            self.pending = Some(reading);
        }
        accepted
    }
}

/// Reads the box twice, as it is and inverted: light text over the game
/// reads best one way or the other depending on the scene behind.
#[cfg(windows)]
async fn read_both(image: xcap::image::RgbaImage) -> Result<(Lines, Lines), String> {
    let plain = crate::capture::read_region(image.clone(), false).await?;
    let inverted = crate::capture::read_region(image, true).await?;
    Ok((lines(&plain), lines(&inverted)))
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
    let found = match read_both(frame.crop(selection)?).await {
        Ok((plain, inverted)) => agreed(plain, inverted).is_some(),
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
        #[cfg(windows)]
        let mut motion = Motion::default();
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
                        if motion.accept((fix.x, fix.y, fix.z), fix.at) {
                            if let Err(error) = app.emit(POSITION_EVENT, fix) {
                                log(format!("nps: cannot send the position: {error}"));
                            }
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

    let (plain, inverted) = read_both(image).await?;
    Ok(agreed(plain, inverted).map(|(x, y, z)| Fix {
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

    /// What one reading gives: the `SolarSystem` line, or the `Root` line.
    fn parse(text: &str) -> Option<Position> {
        let found = lines(text);
        found.solar.or(found.root)
    }

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
    fn a_misread_digit_is_not_confirmed() {
        let right = lines(DISPLAY_INFO);
        // A 2 read as a 9 on the `SolarSystem` line, and the `Root` line lost.
        let wrong =
            lines("Zone: SolarSystem_8629 Pos: 16729220.4026km -19942047.4831km 9239.7445km");
        assert_eq!(agreed(wrong, Lines::default()), None);
        assert!(agreed(wrong, Lines::default()).is_none());
        // The other reading of the same image confirms the right line.
        assert_eq!(agreed(wrong, right), right.solar);
    }

    #[test]
    fn the_root_line_confirms_the_solar_system_line() {
        let both = lines(DISPLAY_INFO);
        assert_eq!(agreed(both, Lines::default()), both.solar);
        let solar_only = Lines { root: None, ..both };
        assert_eq!(agreed(solar_only, Lines::default()), None);
        assert_eq!(agreed(solar_only, solar_only), both.solar);
    }

    #[test]
    fn roots_alone_need_each_other() {
        let root = Some((1.0, 2.0, 3.0));
        let only = Lines { solar: None, root };
        assert_eq!(agreed(only, Lines::default()), None);
        assert_eq!(agreed(only, only), root);
    }

    #[test]
    fn a_jump_waits_for_the_next_reading() {
        let mut motion = Motion::default();
        assert!(motion.accept((0.0, 0.0, 0.0), 0));
        assert!(motion.accept((200.0, 0.0, 0.0), 1_000));
        // Seven kilometres in a second: a misread, dropped…
        assert!(!motion.accept((7_200.0, 0.0, 0.0), 2_000));
        // …since the next reading carries on from before it.
        assert!(motion.accept((400.0, 0.0, 0.0), 3_000));
        // A quantum jump: held back, then confirmed by the reading after.
        assert!(!motion.accept((9.0e9, 0.0, 0.0), 4_000));
        assert!(motion.accept((9.0e9 + 100.0, 0.0, 0.0), 5_000));
        assert!(motion.accept((9.0e9 + 300.0, 0.0, 0.0), 6_000));
    }

    #[test]
    fn needs_three_values() {
        assert_eq!(parse("Zone: SolarSystem_1 Pos: 1.0km 2.0km"), None);
    }
}
