//! The Windows clipboard, as plain text, for the NPS (`nps.rs`).
//!
//! Straight Win32 rather than a crate: the `windows` crate is already in the
//! tree for capture and OCR, and three calls do not justify another
//! dependency. Windows only, matching the only target platform; elsewhere the
//! clipboard simply reads empty and refuses to be written.

/// Changes every time anything is copied, by any program. Reading it costs
/// nothing, which is what lets the NPS watch for `/showlocation` without
/// opening the clipboard on every tick.
#[cfg(windows)]
pub(crate) fn sequence() -> u32 {
    // SAFETY: no arguments, no state; returns 0 when the station has no
    // clipboard access.
    unsafe { windows::Win32::System::DataExchange::GetClipboardSequenceNumber() }
}

#[cfg(not(windows))]
pub(crate) fn sequence() -> u32 {
    0
}

/// Longest text read, in UTF-16 units. A `/showlocation` line is under a
/// hundred; anything longer is someone else's copy, and is not walked through.
#[cfg(windows)]
const MAX_READ: usize = 512;

#[cfg(windows)]
mod win {
    use std::thread::sleep;
    use std::time::Duration;

    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable,
        OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Ole::CF_UNICODETEXT;

    use super::MAX_READ;

    fn format() -> u32 {
        u32::from(CF_UNICODETEXT.0)
    }

    /// The clipboard, held open; closed when dropped.
    ///
    /// Another program may hold it for a moment — the game, writing its line —
    /// so opening is retried a few times before giving up.
    struct Open;

    impl Open {
        fn new() -> Result<Self, String> {
            let mut last = String::new();
            for _ in 0..5 {
                // SAFETY: no owner window; the matching close is in `Drop`.
                match unsafe { OpenClipboard(None) } {
                    Ok(()) => return Ok(Open),
                    Err(error) => last = error.to_string(),
                }
                sleep(Duration::from_millis(10));
            }
            Err(format!("clipboard busy: {last}"))
        }
    }

    impl Drop for Open {
        fn drop(&mut self) {
            // SAFETY: opened by `Open::new` on this thread.
            let _ = unsafe { CloseClipboard() };
        }
    }

    pub(super) fn read_text() -> Option<String> {
        // SAFETY: a format query, no handle involved.
        unsafe { IsClipboardFormatAvailable(format()) }.ok()?;
        let _open = Open::new().ok()?;

        // SAFETY: the clipboard is open; the handle stays owned by it.
        let handle = unsafe { GetClipboardData(format()) }.ok()?;
        let global = HGLOBAL(handle.0);
        // SAFETY: `CF_UNICODETEXT` data is a NUL-terminated UTF-16 buffer in a
        // global memory object, locked for as long as it is read.
        let pointer = unsafe { GlobalLock(global) } as *const u16;
        if pointer.is_null() {
            return None;
        }

        let mut length = 0;
        // SAFETY: the buffer ends with a NUL, and the walk stops there or at
        // `MAX_READ`, whichever comes first.
        while length < MAX_READ && unsafe { *pointer.add(length) } != 0 {
            length += 1;
        }
        // SAFETY: `length` units were just read one by one.
        let text = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(pointer, length) });

        // SAFETY: locked above.
        let _ = unsafe { GlobalUnlock(global) };
        Some(text)
    }

    pub(super) fn write_text(text: &str) -> Result<(), String> {
        let wide: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
        let _open = Open::new()?;

        // SAFETY: the clipboard is open; emptying it makes us its owner, which
        // `SetClipboardData` requires.
        unsafe { EmptyClipboard() }.map_err(|error| error.to_string())?;

        // SAFETY: a fresh allocation, filled while locked, then handed to the
        // clipboard — which owns it from then on — or freed if it refuses.
        unsafe {
            let global =
                GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2).map_err(|error| error.to_string())?;
            let pointer = GlobalLock(global) as *mut u16;
            if pointer.is_null() {
                let _ = GlobalFree(Some(global));
                return Err("cannot lock clipboard memory".to_string());
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), pointer, wide.len());
            let _ = GlobalUnlock(global);

            if let Err(error) = SetClipboardData(format(), Some(HANDLE(global.0))) {
                let _ = GlobalFree(Some(global));
                return Err(error.to_string());
            }
        }
        Ok(())
    }
}

/// What the clipboard holds as text, if anything.
#[cfg(windows)]
pub(crate) fn read_text() -> Option<String> {
    win::read_text()
}

#[cfg(not(windows))]
pub(crate) fn read_text() -> Option<String> {
    None
}

/// Puts `text` on the clipboard, replacing what was there.
#[cfg(windows)]
pub(crate) fn write_text(text: &str) -> Result<(), String> {
    win::write_text(text)
}

#[cfg(not(windows))]
pub(crate) fn write_text(_text: &str) -> Result<(), String> {
    Err("The clipboard is only available on Windows.".to_string())
}
