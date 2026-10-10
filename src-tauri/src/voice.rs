//! The microphone, for talking to Nexus Chat.
//!
//! Read here rather than in the webview: the chat overlay is hidden most of
//! the time and never has the focus over a game, and a webview may hold back a
//! page that is not on screen. WASAPI, through `cpal`, records whatever the
//! windows are doing.
//!
//! One recording at a time, on its own thread (a `cpal` stream is not `Send`):
//! [`start`] opens the default microphone, [`stop`] closes it and hands back
//! what it heard as a WAV the site transcribes (`POST /api/chat/transcribe`),
//! 16-bit mono at 16 kHz — plenty for a voice, and a minute stays under 2 MB.
//!
//! The answers read aloud are played here too ([`play`]): over a game the
//! webview never gets the click its autoplay policy waits for before it lets
//! a page make a sound.

use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};

use crate::diagnostics::log;

/// What the site expects, and what it accepts at most.
const OUTPUT_RATE: u32 = 16_000;
const MAX_SECONDS: u32 = 60;

/// How long the microphone gets to open before the attempt is given up.
const START_TIMEOUT: Duration = Duration::from_secs(5);

struct Recording {
    stop: Sender<()>,
    thread: JoinHandle<()>,
    samples: Arc<Mutex<Vec<f32>>>,
    rate: u32,
}

static RECORDING: Mutex<Option<Recording>> = Mutex::new(None);

/// Opens the microphone and starts listening. Starting while already
/// listening does nothing: the shortcut and the button may both ask.
pub fn start() -> Result<(), String> {
    let mut slot = RECORDING
        .lock()
        .map_err(|_| "voice state is poisoned".to_string())?;

    if slot.is_some() {
        return Ok(());
    }

    let samples = Arc::new(Mutex::new(Vec::new()));
    let (stop, stopped) = mpsc::channel::<()>();
    let (ready, opened) = mpsc::channel::<Result<u32, String>>();
    let collected = Arc::clone(&samples);

    let thread = std::thread::Builder::new()
        .name("nexus-voice".into())
        .spawn(move || {
            let stream = match open(collected) {
                Ok((stream, rate)) => {
                    let _ = ready.send(Ok(rate));
                    stream
                }
                Err(error) => {
                    let _ = ready.send(Err(error));
                    return;
                }
            };

            // Until `stop` or `cancel` says so, or the sender goes away.
            let _ = stopped.recv();
            drop(stream);
        })
        .map_err(|error| format!("could not start the voice thread: {error}"))?;

    let rate = match opened.recv_timeout(START_TIMEOUT) {
        Ok(Ok(rate)) => rate,
        Ok(Err(error)) => {
            let _ = thread.join();
            log(format!("microphone could not open: {error}"));
            return Err(error);
        }
        Err(_) => {
            let _ = stop.send(());
            log("microphone did not open in time".to_string());
            return Err("microphone_failed".to_string());
        }
    };

    *slot = Some(Recording {
        stop,
        thread,
        samples,
        rate,
    });

    Ok(())
}

/// Closes the microphone and returns what it heard, as a WAV.
pub fn stop() -> Result<Vec<u8>, String> {
    let recording = take()?.ok_or_else(|| "not_recording".to_string())?;
    let _ = recording.stop.send(());
    let _ = recording.thread.join();

    let samples = recording
        .samples
        .lock()
        .map_err(|_| "voice samples are poisoned".to_string())?;

    Ok(wav(&resample(&samples, recording.rate)))
}

/// Closes the microphone and forgets what it heard.
pub fn cancel() {
    if let Ok(Some(recording)) = take() {
        let _ = recording.stop.send(());
        let _ = recording.thread.join();
    }
}

fn take() -> Result<Option<Recording>, String> {
    Ok(RECORDING
        .lock()
        .map_err(|_| "voice state is poisoned".to_string())?
        .take())
}

/// Plays a WAV to the end, or until [`stop_playback`]. Blocks: called from a
/// worker thread.
pub fn play(wav: &[u8]) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::Media::Audio::{PlaySoundW, SND_MEMORY, SND_NODEFAULT, SND_SYNC};

    if wav.len() < 44 || &wav[0..4] != b"RIFF" {
        return Err("not a WAV".to_string());
    }

    // `SND_MEMORY` reads the sound from the pointer instead of a file name.
    let played = unsafe {
        PlaySoundW(
            PCWSTR(wav.as_ptr().cast()),
            None,
            SND_MEMORY | SND_SYNC | SND_NODEFAULT,
        )
    };

    if played.as_bool() {
        Ok(())
    } else {
        Err("the sound could not be played".to_string())
    }
}

/// Cuts off what [`play`] is playing.
pub fn stop_playback() {
    use windows::core::PCWSTR;
    use windows::Win32::Media::Audio::{PlaySoundW, SND_FLAGS};

    unsafe {
        let _ = PlaySoundW(PCWSTR::null(), None, SND_FLAGS(0));
    }
}

/// Opens the default microphone in its own format, collecting mono samples.
fn open(samples: Arc<Mutex<Vec<f32>>>) -> Result<(cpal::Stream, u32), String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "no_microphone".to_string())?;
    let supported = device
        .default_input_config()
        .map_err(|error| format!("microphone_failed: {error}"))?;

    let config = supported.config();
    let rate = config.sample_rate;
    let channels = usize::from(config.channels.max(1));
    let limit = (rate * MAX_SECONDS) as usize;

    let stream = match supported.sample_format() {
        SampleFormat::F32 => build::<f32>(&device, config, channels, limit, samples),
        SampleFormat::I16 => build::<i16>(&device, config, channels, limit, samples),
        SampleFormat::U16 => build::<u16>(&device, config, channels, limit, samples),
        SampleFormat::I32 => build::<i32>(&device, config, channels, limit, samples),
        SampleFormat::U8 => build::<u8>(&device, config, channels, limit, samples),
        other => return Err(format!("microphone_failed: unsupported format {other:?}")),
    }?;

    stream
        .play()
        .map_err(|error| format!("microphone_failed: {error}"))?;

    Ok((stream, rate))
}

fn build<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    channels: usize,
    limit: usize,
    samples: Arc<Mutex<Vec<f32>>>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                let Ok(mut collected) = samples.lock() else {
                    return;
                };
                for frame in data.chunks(channels) {
                    if collected.len() >= limit {
                        return;
                    }
                    let sum: f32 = frame.iter().map(|sample| sample.to_sample::<f32>()).sum();
                    collected.push(sum / frame.len() as f32);
                }
            },
            |error| log(format!("microphone stream error: {error}")),
            None,
        )
        .map_err(|error| format!("microphone_failed: {error}"))
}

/// Down to `OUTPUT_RATE`, averaging each window: enough of a low-pass for a
/// voice that is only going to be transcribed.
fn resample(samples: &[f32], rate: u32) -> Vec<f32> {
    if rate == OUTPUT_RATE || rate == 0 {
        return samples.to_vec();
    }

    let ratio = f64::from(rate) / f64::from(OUTPUT_RATE);
    let length = (samples.len() as f64 / ratio) as usize;

    (0..length)
        .map(|index| {
            let start = (index as f64 * ratio) as usize;
            let end = (((index + 1) as f64 * ratio) as usize).min(samples.len());
            if end <= start {
                return samples.get(start).copied().unwrap_or(0.0);
            }
            samples[start..end].iter().sum::<f32>() / (end - start) as f32
        })
        .collect()
}

/// A 16-bit mono WAV at `OUTPUT_RATE`.
fn wav(samples: &[f32]) -> Vec<u8> {
    let data_size = (samples.len() * 2) as u32;
    let mut bytes = Vec::with_capacity(44 + samples.len() * 2);

    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_size).to_le_bytes());
    bytes.extend_from_slice(b"WAVE");
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&OUTPUT_RATE.to_le_bytes());
    bytes.extend_from_slice(&(OUTPUT_RATE * 2).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_size.to_le_bytes());

    for sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let value = (clamped * f32::from(i16::MAX)) as i16;
        bytes.extend_from_slice(&value.to_le_bytes());
    }

    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resamples_to_sixteen_kilohertz() {
        let samples = vec![0.5; 48_000];
        let out = resample(&samples, 48_000);
        assert_eq!(out.len(), 16_000);
        assert!(out.iter().all(|sample| (sample - 0.5).abs() < f32::EPSILON));
    }

    #[test]
    fn writes_a_wav_header() {
        let bytes = wav(&[0.0, 1.0, -1.0]);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(
            u32::from_le_bytes(bytes[24..28].try_into().unwrap()),
            16_000
        );
        assert_eq!(u32::from_le_bytes(bytes[40..44].try_into().unwrap()), 6);
        assert_eq!(bytes.len(), 50);
        assert_eq!(i16::from_le_bytes([bytes[46], bytes[47]]), i16::MAX);
    }
}
