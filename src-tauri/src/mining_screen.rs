//! Mining assistance: the charge gauge of the mining HUD, read off the screen.
//!
//! The player draws a box once around the "Charge level" arc (the
//! calibration, through the capture window, as for the radar scanner). While
//! the mining window is on screen, that box is grabbed a few times a second
//! and its colours read — no OCR: the charge is the bright green bar climbing
//! the arc from the bottom, the optimal window the dark green block, the
//! overcharge the red one above it. From where the bar stands against the two
//! blocks, and whether it still climbs, comes one piece of advice: raise the
//! laser power, hold, lower it, or cut the laser.
//!
//! By default that advice is only shown. The automatic mode, off unless the
//! player turns it on, acts on it with the mouse wheel and a click, sent only
//! while Star Citizen is the foreground window (`act`). That is input
//! automation, which the game's terms frown upon: the mining window says so
//! where it is switched on.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::capture::Selection;
use crate::diagnostics::log;
use crate::nps_screen::Region;

/// The mining window.
pub(crate) const MINING_WINDOW: &str = "mining";

/// Carries a [`Status`] to the mining window, each time it changes.
const STATUS_EVENT: &str = "mining://status";

/// Carries a [`Calibrated`] to the mining window once a box has been drawn.
const CALIBRATED_EVENT: &str = "mining://calibrated";

/// Carries a [`Reading`] to the mining window, at every reading.
const READING_EVENT: &str = "mining://reading";

/// Bounds on the reading interval: the charge moves within a second, so
/// faster than the radar scanner, but no faster than the screen is worth.
const MIN_INTERVAL_MS: u64 = 100;
const MAX_INTERVAL_MS: u64 = 2_000;

/// How long to wait, with the assistance off, before looking at the settings
/// again.
const IDLE_INTERVAL: Duration = Duration::from_millis(500);

/// How far back the climb of the charge is measured.
const TREND_WINDOW_MS: u64 = 1_200;

/// How much of the box the charge must climb over [`TREND_WINDOW_MS`] to be
/// said to climb: under it, the bar is as good as still.
const RISING_EPSILON: f32 = 0.01;

/// How far past the overcharge block's edge, or the window's top, in
/// fractions of the box, the bar may go before the laser is cut: the edges
/// read a pixel or two off.
const OVERCHARGE_MARGIN: f32 = 0.005;

/// The top share of the window where a climbing bar has the power lowered,
/// before it overcharges.
const WINDOW_TOP_SHARE: f32 = 0.25;

/// How far under the optimal window, in fractions of the box, the charge bar
/// must start to be one.
const MIN_BAR_BELOW_WINDOW: f32 = 0.03;

/// Readings in a row that must give the same advice before the automatic mode
/// acts on it: one odd frame (a rock passing behind the arc) is not enough.
const AUTO_CONFIRMATIONS: u32 = 2;

/// The shortest time between two turns of the wheel from the automatic mode,
/// so the game has shown the new power before the next one.
const AUTO_WHEEL_COOLDOWN_MS: u64 = 450;

/// What the mining window asks for. It owns these settings and keeps them in
/// the store; this only holds the copy the loop reads.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub enabled: bool,
    pub interval_ms: u64,
    pub region: Option<Region>,
    /// Acts on the advice with the wheel and a click. Off unless the player
    /// turns it on, knowingly.
    #[serde(default)]
    pub auto: bool,
    /// Whether turning the wheel up raises the power, as the game binds it by
    /// default.
    #[serde(default = "default_true")]
    pub wheel_up_raises: bool,
    /// Wheel notches sent each time the power is changed.
    #[serde(default = "default_notches")]
    pub notches: u32,
    /// Whether the automatic mode may cut the laser at the overcharge.
    #[serde(default = "default_true")]
    pub auto_cut: bool,
}

fn default_true() -> bool {
    true
}

fn default_notches() -> u32 {
    1
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_ms: 250,
            region: None,
            auto: false,
            wheel_up_raises: true,
            notches: default_notches(),
            auto_cut: true,
        }
    }
}

/// How the reading goes, for the mining window to say.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum Status {
    /// Off, not calibrated, or the window is hidden.
    Idle,
    /// The gauge is found in the box.
    Reading,
    /// Neither the charge nor the optimal window in the box: not in mining
    /// mode, or something covers it.
    Unreadable,
    /// The screen could not be grabbed at all.
    Failed { message: String },
}

/// What the gauge shows, in fractions of the box's height from its top: the
/// arc fills upwards, so a smaller number is a higher charge.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gauge {
    /// The top of the charge bar; `None` when there is none: the laser is
    /// off, or not on a rock.
    pub charge: Option<f32>,
    /// Where the bar starts, at the bottom of the arc.
    pub charge_base: Option<f32>,
    /// The optimal window, top then bottom.
    pub window: Option<(f32, f32)>,
    /// The bottom edge of the overcharge block.
    pub overcharge: Option<f32>,
}

impl Gauge {
    fn found(&self) -> bool {
        self.charge.is_some() || self.window.is_some()
    }
}

/// What to do with the laser.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Advice {
    /// No charge bar: the laser is off.
    Off,
    /// Under the optimal window and not climbing: more power.
    Raise,
    /// Under the window but climbing, or in it: leave it be.
    Hold,
    /// Above the window: less power before it overcharges.
    Lower,
    /// At the overcharge: cut the laser now.
    Cut,
}

/// A reading of the gauge, the advice drawn from it, and when.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    pub gauge: Gauge,
    pub advice: Advice,
    /// Whether the charge climbs.
    pub rising: bool,
    /// What the automatic mode did on this reading, if anything.
    pub acted: Option<Act>,
    pub at: u64,
}

/// What the automatic mode sent to the game.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Act {
    Raised,
    Lowered,
    Cut,
    /// It would have, but Star Citizen was not the foreground window.
    NotFocused,
}

/// What came of a calibration.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Calibrated {
    /// `None` when the box drawn was too small to keep.
    pub region: Option<Region>,
    /// The gauge read in the box straight away.
    pub gauge: Option<Gauge>,
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

/// Applies the settings chosen in the mining window.
#[tauri::command]
pub fn mining_screen_configure(app: AppHandle, settings: Settings) {
    if let Ok(mut current) = app.state::<Tracking>().0.lock() {
        *current = settings;
    }
}

// ---------------------------------------------------------------------------
// Reading the gauge
// ---------------------------------------------------------------------------

/// What one pixel of the arc is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Ink {
    /// The bright green of the charge bar.
    Charge,
    /// The dark green of the optimal window.
    Window,
    /// The red of the overcharge block.
    Overcharge,
}

fn ink(r: u8, g: u8, b: u8) -> Option<Ink> {
    let (r, g, b) = (r as i32, g as i32, b as i32);
    // Measured on the HUD: the bar is about (80, 230, 130); the window
    // block, seen through, about (20, 66, 43); the overcharge block about
    // (68, 27, 24). The labels beside the arc are a paler mint, (160, 255,
    // 140) or (129, 246, 202): too much red or blue in them for the bar.
    if g > 150 && r < 130 && g > r + 90 && g > b + 70 {
        Some(Ink::Charge)
    } else if g > 50 && g > r + 30 && g > b + 15 {
        Some(Ink::Window)
    } else if r > 50 && r > g + 30 && r > b + 30 {
        Some(Ink::Overcharge)
    } else {
        None
    }
}

/// The rows of a block of colour: the longest run of rows that each hold a
/// good share of the busiest row's pixels, small gaps forgiven. A thin line
/// of the same colour (the arc's own outline) never makes the share.
fn block(counts: &[u32]) -> Option<(usize, usize)> {
    let busiest = *counts.iter().max()?;
    if busiest < 3 {
        return None;
    }
    let threshold = (busiest / 4).max(3);
    let gap = (counts.len() / 60).max(2);

    let mut best: Option<(usize, usize)> = None;
    let mut run: Option<(usize, usize)> = None;
    for (row, &count) in counts.iter().enumerate() {
        if count < threshold {
            continue;
        }
        run = match run {
            Some((start, end)) if row - end <= gap + 1 => Some((start, row)),
            _ => Some((row, row)),
        };
        if let Some((start, end)) = run {
            if best.is_none_or(|(s, e)| end - start > e - s) {
                best = Some((start, end));
            }
        }
    }
    best
}

/// The charge bar: from its lowest row, climbed row by row while each next
/// row has bar pixels near the ones below, so that green text beside the arc
/// (the OPTIMAL label) is not taken for the bar. Returns its top and bottom.
fn charge_bar(rows: &[Vec<u32>], width: usize) -> Option<(usize, usize)> {
    let reach = (width / 8).max(8) as i64;
    let gap = (rows.len() / 40).max(4);

    let bottom = rows.iter().rposition(|xs| xs.len() >= 2)?;
    let mut top = bottom;
    let (mut low, mut high) = span(&rows[bottom]);
    let mut missed = 0;
    for row in (0..bottom).rev() {
        let near: Vec<u32> = rows[row]
            .iter()
            .copied()
            .filter(|&x| (x as i64) >= low - reach && (x as i64) <= high + reach)
            .collect();
        if near.is_empty() {
            missed += 1;
            if missed > gap {
                break;
            }
            continue;
        }
        missed = 0;
        top = row;
        (low, high) = span(&near);
    }
    Some((top, bottom))
}

fn span(xs: &[u32]) -> (i64, i64) {
    let low = xs.iter().copied().min().unwrap_or(0) as i64;
    let high = xs.iter().copied().max().unwrap_or(0) as i64;
    (low, high)
}

/// Reads the gauge in a box of RGBA pixels, row after row.
pub fn read_gauge(pixels: &[u8], width: u32, height: u32) -> Gauge {
    let (width, height) = (width as usize, height as usize);
    if width == 0 || height == 0 || pixels.len() < width * height * 4 {
        return Gauge::default();
    }

    let mut charge_rows: Vec<Vec<u32>> = vec![Vec::new(); height];
    let mut window_counts = vec![0u32; height];
    let mut overcharge_counts = vec![0u32; height];
    for y in 0..height {
        for x in 0..width {
            let i = (y * width + x) * 4;
            match ink(pixels[i], pixels[i + 1], pixels[i + 2]) {
                Some(Ink::Charge) => charge_rows[y].push(x as u32),
                Some(Ink::Window) => window_counts[y] += 1,
                Some(Ink::Overcharge) => overcharge_counts[y] += 1,
                None => {}
            }
        }
    }

    let fraction = |row: usize| row as f32 / height as f32;
    let window = block(&window_counts).map(|(top, bottom)| (fraction(top), fraction(bottom)));
    let overcharge = block(&overcharge_counts).map(|(_, bottom)| fraction(bottom));
    // A bar starts at the bottom of the arc, under the window, and is more
    // than a speck: a green tick in the window, or a stray glyph, is none.
    let bar = charge_bar(&charge_rows, width).filter(|&(top, bottom)| {
        let long_enough = bottom - top >= (height / 50).max(4);
        let under_window = window.is_none_or(|(_, window_bottom)| {
            fraction(bottom) > window_bottom + MIN_BAR_BELOW_WINDOW
        });
        long_enough && under_window
    });

    Gauge {
        charge: bar.map(|(top, _)| fraction(top)),
        charge_base: bar.map(|(_, bottom)| fraction(bottom)),
        window,
        overcharge,
    }
}

/// The advice for a gauge, given whether the charge climbs.
///
/// On the HUD the overcharge block sits right on top of the window: past the
/// window's top edge is the overcharge. So the power is lowered while there
/// is still room, when a climbing bar reaches the top of the window, and the
/// laser cut once it is through.
pub fn advise(gauge: &Gauge, rising: bool) -> Advice {
    let Some(charge) = gauge.charge else {
        return Advice::Off;
    };
    if gauge
        .overcharge
        .is_some_and(|overcharge| charge <= overcharge + OVERCHARGE_MARGIN)
    {
        return Advice::Cut;
    }
    let Some((top, bottom)) = gauge.window else {
        // No window seen: nothing to aim for.
        return Advice::Hold;
    };
    // The top of the bar is higher, so a smaller number.
    if charge < top - OVERCHARGE_MARGIN {
        Advice::Cut
    } else if charge > bottom {
        if rising {
            Advice::Hold
        } else {
            Advice::Raise
        }
    } else if rising && charge < top + (bottom - top) * WINDOW_TOP_SHARE {
        Advice::Lower
    } else {
        Advice::Hold
    }
}

/// The charge over the last moments, to tell a climbing bar from a still one.
#[derive(Default)]
pub struct Trend {
    samples: VecDeque<(u64, f32)>,
}

impl Trend {
    /// Records a reading and says whether the charge climbs.
    pub fn push(&mut self, at: u64, charge: Option<f32>) -> bool {
        let Some(charge) = charge else {
            self.samples.clear();
            return false;
        };
        self.samples.push_back((at, charge));
        while let Some(&(first, _)) = self.samples.front() {
            if at.saturating_sub(first) > TREND_WINDOW_MS && self.samples.len() > 2 {
                self.samples.pop_front();
            } else {
                break;
            }
        }
        let Some(&(first_at, first)) = self.samples.front() else {
            return false;
        };
        // Too short a history says nothing yet: holding is the safe answer.
        if at.saturating_sub(first_at) < TREND_WINDOW_MS / 2 {
            return true;
        }
        first - charge > RISING_EPSILON
    }
}

// ---------------------------------------------------------------------------
// The automatic mode
// ---------------------------------------------------------------------------

/// Decides what the automatic mode sends, from the advice of each reading:
/// an advice must hold for [`AUTO_CONFIRMATIONS`] readings, the wheel waits
/// [`AUTO_WHEEL_COOLDOWN_MS`] between turns, and once the laser is cut nothing
/// more is sent until the bar is gone — the click toggles, and a second one
/// would fire it again.
#[derive(Default)]
pub struct Pilot {
    last: Option<Advice>,
    streak: u32,
    last_wheel: Option<u64>,
    cut: bool,
}

/// What the pilot wants sent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    Wheel { raise: bool },
    Click,
}

impl Pilot {
    pub fn next(&mut self, advice: Advice, at: u64, settings: &Settings) -> Option<Command> {
        if self.last == Some(advice) {
            self.streak += 1;
        } else {
            self.last = Some(advice);
            self.streak = 1;
        }

        if advice == Advice::Off {
            self.cut = false;
            return None;
        }
        if self.cut || self.streak < AUTO_CONFIRMATIONS {
            return None;
        }

        match advice {
            Advice::Cut if settings.auto_cut => {
                self.cut = true;
                Some(Command::Click)
            }
            Advice::Raise | Advice::Lower => {
                let cooled = self
                    .last_wheel
                    .is_none_or(|then| at.saturating_sub(then) >= AUTO_WHEEL_COOLDOWN_MS);
                if !cooled {
                    return None;
                }
                self.last_wheel = Some(at);
                Some(Command::Wheel {
                    raise: advice == Advice::Raise,
                })
            }
            _ => None,
        }
    }
}

/// Whether the window in front is the game's: input goes nowhere else.
#[cfg(windows)]
fn game_focused() -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};

    // SAFETY: plain Win32 calls on a buffer we own; a null window reads as
    // an empty title.
    unsafe {
        let window = GetForegroundWindow();
        if window.is_invalid() {
            return false;
        }
        let mut title = [0u16; 256];
        let length = GetWindowTextW(window, &mut title);
        let title = String::from_utf16_lossy(&title[..length.max(0) as usize]);
        title.starts_with("Star Citizen")
    }
}

/// Sends a command to the game, as mouse input.
#[cfg(windows)]
fn send(command: Command, settings: &Settings) -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
        MOUSEEVENTF_WHEEL, MOUSEINPUT, MOUSE_EVENT_FLAGS,
    };
    use windows::Win32::UI::WindowsAndMessaging::WHEEL_DELTA;

    fn mouse(flags: MOUSE_EVENT_FLAGS, data: i32) -> INPUT {
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: data as u32,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    let inputs: Vec<INPUT> = match command {
        Command::Wheel { raise } => {
            let up = raise == settings.wheel_up_raises;
            let delta = WHEEL_DELTA as i32 * if up { 1 } else { -1 };
            (0..settings.notches.clamp(1, 10))
                .map(|_| mouse(MOUSEEVENTF_WHEEL, delta))
                .collect()
        }
        Command::Click => vec![mouse(MOUSEEVENTF_LEFTDOWN, 0), mouse(MOUSEEVENTF_LEFTUP, 0)],
    };

    // SAFETY: `inputs` lives across the call and the size is the struct's.
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err(format!("SendInput sent {sent} of {} events", inputs.len()))
    }
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn gauge_of(image: &xcap::image::RgbaImage) -> Gauge {
    read_gauge(image.as_raw(), image.width(), image.height())
}

/// Records the box just drawn in the capture window, reads the gauge in it on
/// the frozen screen, and hands both back to the mining window.
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
            log(format!("mining: calibration box refused: {error}"));
            Calibrated {
                region: None,
                gauge: None,
            }
        }
        #[cfg_attr(not(windows), allow(unused_variables))]
        Ok(image) => {
            #[cfg(windows)]
            let gauge = Some(gauge_of(&image)).filter(Gauge::found);
            #[cfg(not(windows))]
            let gauge = None;
            app.state::<Tracking>().set_region(region);
            Calibrated {
                region: Some(region),
                gauge,
            }
        }
    };

    app.emit_to(MINING_WINDOW, CALIBRATED_EVENT, calibrated)
        .map_err(|e| e.to_string())
}

fn announce(app: &AppHandle, last: &mut Status, status: Status) {
    if *last == status {
        return;
    }
    if let Status::Failed { message } = &status {
        log(format!("mining: cannot read the screen: {message}"));
    }
    *last = status.clone();
    if let Err(error) = app.emit_to(MINING_WINDOW, STATUS_EVENT, status) {
        log(format!("mining: cannot send the status: {error}"));
    }
}

#[cfg(windows)]
fn watched(app: &AppHandle) -> bool {
    app.get_webview_window(MINING_WINDOW)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

/// Starts the reading loop, for the life of the app. Called once from `setup`.
pub(crate) fn install(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last = Status::Idle;
        #[cfg(windows)]
        let mut trend = Trend::default();
        #[cfg(windows)]
        let mut pilot = Pilot::default();
        loop {
            let settings = app.state::<Tracking>().get();
            #[cfg(windows)]
            let region = settings
                .region
                .filter(|_| settings.enabled && watched(&app));
            #[cfg(not(windows))]
            let region: Option<Region> = None;

            let Some(region) = region else {
                #[cfg(windows)]
                {
                    trend = Trend::default();
                    pilot = Pilot::default();
                }
                announce(&app, &mut last, Status::Idle);
                tokio::time::sleep(IDLE_INTERVAL).await;
                continue;
            };

            let interval = settings.interval_ms.clamp(MIN_INTERVAL_MS, MAX_INTERVAL_MS);
            let started = std::time::Instant::now();

            #[cfg(windows)]
            {
                let grabbed = tauri::async_runtime::spawn_blocking(move || {
                    crate::capture::grab_region(
                        (region.monitor_x, region.monitor_y),
                        region.selection,
                    )
                    .map(|image| gauge_of(&image))
                })
                .await
                .map_err(|e| e.to_string())
                .and_then(|result| result);

                let status = match grabbed {
                    Ok(gauge) if gauge.found() => {
                        let at = crate::nps::now_ms();
                        let rising = trend.push(at, gauge.charge);
                        let advice = advise(&gauge, rising);
                        let acted = if settings.auto {
                            pilot.next(advice, at, &settings).map(|command| {
                                if !game_focused() {
                                    return Act::NotFocused;
                                }
                                if let Err(error) = send(command, &settings) {
                                    log(format!("mining: cannot send input: {error}"));
                                }
                                match command {
                                    Command::Click => Act::Cut,
                                    Command::Wheel { raise: true } => Act::Raised,
                                    Command::Wheel { raise: false } => Act::Lowered,
                                }
                            })
                        } else {
                            pilot = Pilot::default();
                            None
                        };
                        let reading = Reading {
                            gauge,
                            advice,
                            rising,
                            acted,
                            at,
                        };
                        if let Err(error) = app.emit_to(MINING_WINDOW, READING_EVENT, reading) {
                            log(format!("mining: cannot send the reading: {error}"));
                        }
                        Status::Reading
                    }
                    Ok(_) => {
                        trend = Trend::default();
                        pilot = Pilot::default();
                        Status::Unreadable
                    }
                    Err(message) => Status::Failed { message },
                };
                announce(&app, &mut last, status);
            }
            #[cfg(not(windows))]
            let _ = (region, &settings);

            let rest = Duration::from_millis(interval).saturating_sub(started.elapsed());
            tokio::time::sleep(rest).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: u32 = 60;
    const H: u32 = 200;

    /// A box with the HUD's three colours painted on: an overcharge block,
    /// a window block, and a charge bar from the bottom up to `charge`.
    fn hud(window: (u32, u32), overcharge_bottom: u32, charge: Option<u32>) -> Vec<u8> {
        let mut pixels = vec![10u8; (W * H * 4) as usize];
        let mut paint = |x: u32, y: u32, rgb: (u8, u8, u8)| {
            let i = ((y * W + x) * 4) as usize;
            pixels[i] = rgb.0;
            pixels[i + 1] = rgb.1;
            pixels[i + 2] = rgb.2;
        };
        for y in 0..=overcharge_bottom {
            for x in 5..35 {
                paint(x, y, (120, 30, 30));
            }
        }
        for y in window.0..=window.1 {
            for x in 5..35 {
                paint(x, y, (30, 90, 50));
            }
        }
        if let Some(top) = charge {
            for y in top..H - 10 {
                for x in 40..43 {
                    paint(x, y, (90, 230, 120));
                }
            }
        }
        pixels
    }

    fn close(a: f32, b: f32) -> bool {
        (a - b).abs() < 0.02
    }

    #[test]
    fn reads_the_three_blocks() {
        let gauge = read_gauge(&hud((60, 90), 55, Some(150)), W, H);
        let (top, bottom) = gauge.window.unwrap();
        assert!(close(top, 0.30) && close(bottom, 0.45), "{gauge:?}");
        assert!(close(gauge.overcharge.unwrap(), 0.275), "{gauge:?}");
        assert!(close(gauge.charge.unwrap(), 0.75), "{gauge:?}");
        assert!(close(gauge.charge_base.unwrap(), 0.945), "{gauge:?}");
    }

    #[test]
    fn no_bar_is_a_laser_off() {
        let gauge = read_gauge(&hud((60, 90), 55, None), W, H);
        assert_eq!(gauge.charge, None);
        assert!(gauge.found());
        assert_eq!(advise(&gauge, false), Advice::Off);
    }

    #[test]
    fn green_text_beside_the_arc_is_not_the_bar() {
        let mut pixels = hud((60, 90), 55, Some(150));
        // An OPTIMAL label, bright green, to the left of the bar and far
        // from it, at the window's bottom.
        for y in 92..96 {
            for x in 8..20 {
                let i = ((y * W + x) * 4) as usize;
                pixels[i] = 90;
                pixels[i + 1] = 230;
                pixels[i + 2] = 120;
            }
        }
        let gauge = read_gauge(&pixels, W, H);
        assert!(close(gauge.charge.unwrap(), 0.75), "{gauge:?}");
    }

    #[test]
    fn an_empty_box_is_unreadable() {
        let pixels = vec![10u8; (W * H * 4) as usize];
        assert!(!read_gauge(&pixels, W, H).found());
        assert!(!read_gauge(&[], 0, 0).found());
    }

    #[test]
    fn advice_follows_the_bar() {
        // As on the HUD: the overcharge block ends where the window starts.
        let gauge = |charge| Gauge {
            charge: Some(charge),
            charge_base: Some(0.95),
            window: Some((0.30, 0.46)),
            overcharge: Some(0.29),
        };
        assert_eq!(advise(&gauge(0.8), false), Advice::Raise);
        assert_eq!(advise(&gauge(0.8), true), Advice::Hold);
        assert_eq!(advise(&gauge(0.4), false), Advice::Hold);
        assert_eq!(advise(&gauge(0.4), true), Advice::Hold);
        assert_eq!(advise(&gauge(0.32), true), Advice::Lower);
        assert_eq!(advise(&gauge(0.32), false), Advice::Hold);
        assert_eq!(advise(&gauge(0.30), true), Advice::Lower);
        assert_eq!(advise(&gauge(0.29), true), Advice::Cut);
        assert_eq!(advise(&gauge(0.1), false), Advice::Cut);
        // No overcharge block seen: past the window's top still cuts.
        let mut alone = gauge(0.2);
        alone.overcharge = None;
        assert_eq!(advise(&alone, false), Advice::Cut);
    }

    #[test]
    fn a_tick_in_the_window_is_no_bar() {
        let mut pixels = hud((60, 90), 55, None);
        for y in 80..90 {
            for x in 30..33 {
                let i = ((y * W + x) * 4) as usize;
                pixels[i] = 90;
                pixels[i + 1] = 230;
                pixels[i + 2] = 120;
            }
        }
        assert_eq!(read_gauge(&pixels, W, H).charge, None);
    }

    #[test]
    fn the_trend_sees_a_climb() {
        let mut trend = Trend::default();
        // Too early to say: hold.
        assert!(trend.push(0, Some(0.9)));
        assert!(trend.push(700, Some(0.85)));
        assert!(trend.push(1200, Some(0.80)));
        // Still for over a second: not climbing.
        let mut still = Trend::default();
        for at in (0..2000).step_by(250) {
            still.push(at, Some(0.8));
        }
        assert!(!still.push(2000, Some(0.8)));
        // No bar starts it over.
        assert!(!still.push(2250, None));
    }

    #[test]
    fn the_pilot_waits_confirms_and_cuts_once() {
        let settings = Settings {
            auto: true,
            ..Settings::default()
        };
        let mut pilot = Pilot::default();
        assert_eq!(pilot.next(Advice::Raise, 0, &settings), None);
        assert_eq!(
            pilot.next(Advice::Raise, 250, &settings),
            Some(Command::Wheel { raise: true })
        );
        // The wheel cools down.
        assert_eq!(pilot.next(Advice::Raise, 500, &settings), None);
        assert_eq!(
            pilot.next(Advice::Raise, 750, &settings),
            Some(Command::Wheel { raise: true })
        );
        assert_eq!(pilot.next(Advice::Hold, 1000, &settings), None);
        assert_eq!(pilot.next(Advice::Cut, 1250, &settings), None);
        assert_eq!(
            pilot.next(Advice::Cut, 1500, &settings),
            Some(Command::Click)
        );
        // Once cut, never a second click while the bar is up…
        assert_eq!(pilot.next(Advice::Cut, 1750, &settings), None);
        assert_eq!(pilot.next(Advice::Lower, 2000, &settings), None);
        assert_eq!(pilot.next(Advice::Lower, 2250, &settings), None);
        // …until it is gone.
        assert_eq!(pilot.next(Advice::Off, 2500, &settings), None);
        assert_eq!(pilot.next(Advice::Lower, 2750, &settings), None);
        assert_eq!(
            pilot.next(Advice::Lower, 3000, &settings),
            Some(Command::Wheel { raise: false })
        );
    }

    #[test]
    fn the_pilot_leaves_the_cut_to_the_player_if_asked() {
        let settings = Settings {
            auto: true,
            auto_cut: false,
            ..Settings::default()
        };
        let mut pilot = Pilot::default();
        assert_eq!(pilot.next(Advice::Cut, 0, &settings), None);
        assert_eq!(pilot.next(Advice::Cut, 250, &settings), None);
    }
}
