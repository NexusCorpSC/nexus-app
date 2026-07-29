//! Region screen capture and OCR feeding the quick-search overlay.
//!
//! Windows-only, matching the single target platform. `xcap` reads the monitor
//! pixels and `Windows.Media.Ocr` — the engine shipped with the OS — recognises
//! the text, so there is no Tesseract binary or training data to bundle.

use serde::Deserialize;

/// Smallest selection worth running OCR on, in pixels. Below this a drag is
/// almost certainly a stray click.
#[cfg(windows)]
const MIN_SELECTION_PX: u32 = 8;

/// Longest side an enlarged crop may reach. Windows OCR refuses bitmaps past a
/// limit of its own, a little above this one.
#[cfg(windows)]
const MAX_SCALED_SIDE: u32 = 8_192;

/// Most pixels an enlarged crop may hold: past this the resize costs more time
/// than the sharper glyphs win back.
#[cfg(windows)]
const MAX_SCALED_PIXELS: u32 = 8_000_000;

/// How much to enlarge a crop before reading it, or `None` to read it as it is.
///
/// The engine reads a game HUD far better when the glyphs are document-sized,
/// and a selection drawn around a mission log is small enough to take the full
/// 3× while staying inside both limits.
#[cfg(windows)]
fn upscale(width: u32, height: u32) -> Option<u32> {
    let side = width.max(height).max(1);
    let pixels = width.max(1) * height.max(1);

    (2..=3).rev().find(|factor| {
        side * factor <= MAX_SCALED_SIDE && pixels * factor * factor <= MAX_SCALED_PIXELS
    })
}

#[cfg(not(windows))]
const UNSUPPORTED: &str = "Screen capture is only available on Windows.";

/// Selection rectangle, as fractions (0..1) of the capture window's client area.
///
/// Normalised coordinates keep DPI out of the protocol: the frontend never has
/// to know the monitor's scale factor, and the values map onto the captured
/// image whatever its pixel size.
///
/// The fields are only read by the Windows capture path, but the type stays
/// cross-platform because it is the Tauri command's argument.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Selection {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Where a capture was taken from, in physical pixels of the virtual desktop.
#[derive(Debug, Clone, Copy)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// A frozen monitor snapshot.
///
/// The pixels are grabbed *before* the selection window is shown, so the
/// overlay's own dimming layer can never end up in the OCR input — and the
/// user drags over a still image rather than a moving screen.
pub struct Capture {
    #[cfg(windows)]
    image: xcap::image::RgbaImage,
    pub monitor: MonitorRect,
}

/// Grabs the monitor containing the given virtual-desktop point.
#[cfg(windows)]
pub fn grab(x: i32, y: i32) -> Result<Capture, String> {
    let monitor = xcap::Monitor::from_point(x, y)
        .map_err(|e| format!("no monitor found at ({x}, {y}): {e}"))?;

    let geometry = |label: &str, e: xcap::XCapError| format!("cannot read monitor {label}: {e}");

    let monitor_rect = MonitorRect {
        x: monitor.x().map_err(|e| geometry("x", e))?,
        y: monitor.y().map_err(|e| geometry("y", e))?,
        width: monitor.width().map_err(|e| geometry("width", e))?,
        height: monitor.height().map_err(|e| geometry("height", e))?,
    };

    let image = monitor
        .capture_image()
        .map_err(|e| format!("screen capture failed: {e}"))?;

    Ok(Capture {
        image,
        monitor: monitor_rect,
    })
}

#[cfg(not(windows))]
pub fn grab(_x: i32, _y: i32) -> Result<Capture, String> {
    Err(UNSUPPORTED.to_string())
}

#[cfg(windows)]
impl Selection {
    /// Converts to pixel bounds inside an image, clamped to its edges.
    fn to_pixels(
        self,
        image_width: u32,
        image_height: u32,
    ) -> Result<(u32, u32, u32, u32), String> {
        let to_px = |value: f64, max: u32| {
            (value * f64::from(max)).round().clamp(0.0, f64::from(max)) as u32
        };

        let left = to_px(self.x, image_width);
        let top = to_px(self.y, image_height);
        let right = to_px(self.x + self.width, image_width);
        let bottom = to_px(self.y + self.height, image_height);

        let width = right.saturating_sub(left);
        let height = bottom.saturating_sub(top);

        if width < MIN_SELECTION_PX || height < MIN_SELECTION_PX {
            return Err("selection too small to read".to_string());
        }

        Ok((left, top, width, height))
    }
}

/// Adds context to a WinRT failure.
///
/// A function rather than a closure returning a closure: that form cannot infer
/// a lifetime for a borrowed context. Every caller passes a literal anyway.
#[cfg(windows)]
fn winerr(context: &'static str) -> impl Fn(windows::core::Error) -> String {
    move |error| format!("{context}: {error}")
}

#[cfg(windows)]
impl Capture {
    /// Crops the selection out of the snapshot and returns the text found in it.
    ///
    /// Async because `windows-future` 0.3 dropped the blocking `get()` on
    /// `IAsyncOperation` in favour of `IntoFuture`.
    pub async fn recognize(&self, selection: Selection) -> Result<String, String> {
        use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
        use windows::Media::Ocr::OcrEngine;
        use windows::Storage::Streams::DataWriter;

        let (left, top, width, height) =
            selection.to_pixels(self.image.width(), self.image.height())?;

        let region =
            xcap::image::imageops::crop_imm(&self.image, left, top, width, height).to_image();

        // The engine is trained on document-sized text and reads a game HUD
        // poorly at native resolution: letters come back as their look-alikes
        // and short words are dropped outright. Enlarging the crop first costs
        // a few milliseconds on a region this small and buys back most of it.
        let (region, width, height) = match upscale(width, height) {
            Some(factor) => {
                let (scaled_width, scaled_height) = (width * factor, height * factor);
                (
                    xcap::image::imageops::resize(
                        &region,
                        scaled_width,
                        scaled_height,
                        xcap::image::imageops::FilterType::Lanczos3,
                    ),
                    scaled_width,
                    scaled_height,
                )
            }
            None => (region, width, height),
        };

        // Windows OCR expects BGRA8 while xcap hands back RGBA8. Alpha is
        // forced opaque: a screenshot carries none, and a zero would blank the
        // bitmap the engine sees.
        let mut pixels = region.into_raw();
        for pixel in pixels.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            pixel[3] = 0xFF;
        }

        // Scoped so only `Send` values survive to the await below.
        let bitmap = {
            let writer = DataWriter::new().map_err(winerr("cannot allocate OCR buffer"))?;
            writer
                .WriteBytes(&pixels)
                .map_err(winerr("cannot fill OCR buffer"))?;
            let buffer = writer
                .DetachBuffer()
                .map_err(winerr("cannot detach OCR buffer"))?;

            SoftwareBitmap::CreateCopyFromBuffer(
                &buffer,
                BitmapPixelFormat::Bgra8,
                width as i32,
                height as i32,
            )
            .map_err(winerr("cannot build bitmap"))?
        };

        // Follows the languages configured in Windows; recognition quality
        // depends on the matching language pack being installed.
        let engine = OcrEngine::TryCreateFromUserProfileLanguages().map_err(|e| {
            format!("no OCR engine available ({e}) — install a Windows language pack")
        })?;

        let result = engine
            .RecognizeAsync(&bitmap)
            .map_err(winerr("OCR call failed"))?
            .await
            .map_err(winerr("OCR failed"))?;

        // Line by line rather than `OcrResult::Text()`, which glues every line
        // together with a single space: a mission log read that way arrives as
        // one endless sentence, and the objectives can no longer be told apart.
        let lines = result.Lines().map_err(winerr("cannot read OCR output"))?;
        let count = lines.Size().map_err(winerr("cannot count OCR lines"))?;

        let mut text = String::new();
        for index in 0..count {
            let line = lines
                .GetAt(index)
                .map_err(winerr("cannot read an OCR line"))?
                .Text()
                .map_err(winerr("cannot read an OCR line"))?
                .to_string_lossy();

            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(line);
        }

        Ok(text)
    }
}

#[cfg(not(windows))]
impl Capture {
    pub async fn recognize(&self, _selection: Selection) -> Result<String, String> {
        Err(UNSUPPORTED.to_string())
    }
}
