//! Shortcuts that keep working while a game holds the keyboard.
//!
//! `RegisterHotKey`, which the `global-shortcut` plugin uses, never fires while
//! Star Citizen is in the foreground: the game takes the keyboard for itself and
//! the combination does not reach the app. Raw input sits upstream of that — the
//! device layer reports every keystroke to whoever asked for it, focus or not,
//! which is how the community overlays around the game do it. It reads; it does
//! not hook anything and injects nothing into another process, so there is
//! nothing for an anti-cheat to take exception to.
//!
//! What raw input cannot do is swallow the keystroke: the game sees the
//! combination too. That costs nothing in practice — this path only ever fires
//! where `RegisterHotKey` did not, which is exactly where the game was already
//! receiving the keys.
//!
//! The radial menu adds the mouse, and only while it is up: over a game the
//! cursor is locked, so the menu is steered by the mouse's raw movement, which
//! is reported the same way and for the same reason — whatever has focus.

use std::ffi::c_void;
use std::mem::size_of;
use std::sync::{Mutex, OnceLock};

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_CONTROL, VK_ESCAPE, VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN, VK_MENU,
    VK_RCONTROL, VK_RMENU, VK_RSHIFT, VK_RWIN, VK_SHIFT,
};
use windows::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RIDEV_INPUTSINK, RIDEV_REMOVE, RID_INPUT, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, PostMessageW, RegisterClassW,
    HWND_MESSAGE, MSG, WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP, WM_INPUT, WNDCLASSW,
};

use crate::diagnostics::log;
use crate::{radial, trigger, Action};

/// Keyboard, as the HID usage tables spell it.
const HID_USAGE_PAGE_GENERIC: u16 = 0x01;
const HID_USAGE_GENERIC_KEYBOARD: u16 = 0x06;
const HID_USAGE_GENERIC_MOUSE: u16 = 0x02;

/// Set in `RAWKEYBOARD::Flags` when the key is going up rather than down.
const RI_KEY_BREAK_FLAG: u16 = 0x01;

/// Reported for the fake key that precedes some extended sequences.
const FAKE_VKEY: u16 = 0xFF;

/// Set in `RAWMOUSE::usFlags` when the mouse reports where it is rather than
/// how far it moved — a tablet, a remote desktop. Such reports say nothing
/// about a flick, and are left out.
const MOUSE_MOVE_ABSOLUTE: u16 = 0x01;

/// Posted to the listener's window to start (`wparam` 1) or stop (0) watching
/// the mouse. Raw input devices are registered for a window, and the window is
/// the listener thread's; asking that thread to do it keeps the registration
/// next to the window it names.
const WATCH_MOUSE_MESSAGE: u32 = WM_APP + 1;

/// The combinations to watch for, as virtual key codes: what `Shortcut` holds is
/// a physical `Code`, and raw input reports virtual keys.
static BINDINGS: Mutex<Vec<Binding>> = Mutex::new(Vec::new());

/// Set once the listener is running, so the callback can reach the app.
static APP: OnceLock<AppHandle> = OnceLock::new();

/// The listener's window, once it exists, so other threads can post to it.
/// Held as an integer: a window handle is not `Send`, its value is.
static LISTENER: OnceLock<isize> = OnceLock::new();

struct Binding {
    action: Action,
    key: u16,
    modifiers: Modifiers,
}

/// Starts the listener on its own thread.
///
/// The thread owns a message-only window and pumps it: raw input is delivered as
/// `WM_INPUT` to a window, and keeping that off the main thread means a burst of
/// keystrokes cannot compete with the UI for the event loop.
pub fn start(app: AppHandle) {
    if APP.set(app).is_err() {
        // Already running. Nothing to do: the bindings are shared.
        return;
    }

    let started = std::thread::Builder::new()
        .name("nexus-raw-input".into())
        .spawn(|| {
            if let Err(error) = listen() {
                log(format!("raw input listener stopped: {error}"));
            }
        });

    // Losing the thread costs every shortcut fired from a game, so it may not
    // pass unremarked.
    if let Err(error) = started {
        log(format!("raw input listener could not start: {error}"));
    }
}

/// Replaces the combinations the listener reacts to.
pub fn set_bindings(bound: &[(Action, Shortcut)]) {
    let mut bindings = Vec::with_capacity(bound.len());

    for (action, shortcut) in bound {
        match virtual_key(shortcut.key) {
            Some(key) => bindings.push(Binding {
                action: *action,
                key,
                modifiers: shortcut.mods,
            }),
            // Registered with the system all the same: only this fallback path
            // is lost, and saying which key it was is what makes that
            // diagnosable.
            None => log(format!(
                "raw input cannot watch for {:?}, the key has no virtual key code",
                shortcut.key
            )),
        }
    }

    if let Ok(mut slot) = BINDINGS.lock() {
        *slot = bindings;
    }
}

fn listen() -> windows::core::Result<()> {
    unsafe {
        let instance = GetModuleHandleW(None)?;

        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance.into(),
            lpszClassName: w!("NexusAppRawInput"),
            ..Default::default()
        };

        // A class name already in use means a previous listener registered it;
        // CreateWindowExW below is what actually has to succeed.
        RegisterClassW(&class);

        let window = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("NexusAppRawInput"),
            w!("Nexus App raw input"),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(instance.into()),
            None,
        )?;

        let _ = LISTENER.set(window.0 as isize);

        // `RIDEV_INPUTSINK` is the whole point: deliver keystrokes to this
        // window even though it never has focus — it is not even on screen.
        let devices = [RAWINPUTDEVICE {
            usUsagePage: HID_USAGE_PAGE_GENERIC,
            usUsage: HID_USAGE_GENERIC_KEYBOARD,
            dwFlags: RIDEV_INPUTSINK,
            hwndTarget: window,
        }];

        RegisterRawInputDevices(&devices, size_of::<RAWINPUTDEVICE>() as u32)?;

        // `GetMessageW` answers 0 to quit and -1 on error; both end the loop,
        // which ends the thread — hence the `> 0` rather than `as_bool`.
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).0 > 0 {
            DispatchMessageW(&message);
        }
    }

    Ok(())
}

unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_INPUT {
        on_input(lparam);
    }

    if message == WATCH_MOUSE_MESSAGE {
        register_mouse(window, wparam.0 != 0);
    }

    // Called for WM_INPUT too: the system needs it to release the input data.
    unsafe { DefWindowProcW(window, message, wparam, lparam) }
}

fn on_input(lparam: LPARAM) {
    let mut raw = RAWINPUT::default();
    let mut size = size_of::<RAWINPUT>() as u32;

    let read = unsafe {
        GetRawInputData(
            HRAWINPUT(lparam.0 as *mut c_void),
            RID_INPUT,
            Some(&mut raw as *mut RAWINPUT as *mut c_void),
            &mut size,
            size_of::<RAWINPUTHEADER>() as u32,
        )
    };

    if read == u32::MAX {
        return;
    }

    if raw.header.dwType == RIM_TYPEMOUSE.0 {
        let mouse = unsafe { raw.data.mouse };
        if mouse.usFlags.0 & MOUSE_MOVE_ABSOLUTE == 0 {
            radial::nudge(f64::from(mouse.lLastX), f64::from(mouse.lLastY));
        }
        return;
    }

    if raw.header.dwType != RIM_TYPEKEYBOARD.0 {
        return;
    }

    let keyboard = unsafe { raw.data.keyboard };

    // The placeholder that precedes some extended sequences.
    if keyboard.VKey == FAKE_VKEY {
        return;
    }

    let up = keyboard.Flags & RI_KEY_BREAK_FLAG != 0;

    let Some(app) = APP.get() else {
        return;
    };

    // While the menu is up, letting go of any key of its combination closes it
    // on the sector under the pointer, and Escape calls it off. The watcher in
    // `radial.rs` would notice the release a frame later; this is the fast way.
    if radial::is_open() {
        if !up && keyboard.VKey == VK_ESCAPE.0 {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || radial::cancel(&handle));
            return;
        }

        if up && releases_radial(keyboard.VKey) {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || radial::release(&handle));
            return;
        }
    }

    if up {
        return;
    }

    let Some(action) = matching_action(keyboard.VKey) else {
        return;
    };

    // Held, not fired: the menu stays up until the keys are let go, so the
    // debounce of `trigger` — meant for a press that fires once — is no place
    // for it. Opening an open menu does nothing, which covers auto-repeat.
    if action == Action::Radial {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Err(error) = radial::press(&handle) {
                log(format!("radial menu failed: {error}"));
            }
        });
        return;
    }

    // Auto-repeat sends this many times a second, and `RegisterHotKey` may
    // report the same combination right after: `trigger` drops the repeats.
    // Hopped onto the main thread, which is where windows may be touched.
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || trigger(&handle, action, "raw input"));
}

fn matching_action(key: u16) -> Option<Action> {
    let pressed = held_modifiers();
    let bindings = BINDINGS.lock().ok()?;

    bindings
        .iter()
        .find(|binding| binding.key == key && binding.modifiers == pressed)
        .map(|binding| binding.action)
}

/// Starts or stops watching the mouse, from any thread.
///
/// Watched only while the radial menu is up: reported at the mouse's own rate,
/// up to thousands of times a second, the stream would otherwise wake this
/// thread for nothing the whole time the app runs.
pub fn watch_mouse(on: bool) {
    let Some(window) = LISTENER.get() else {
        return;
    };

    let posted = unsafe {
        PostMessageW(
            Some(HWND(*window as *mut c_void)),
            WATCH_MOUSE_MESSAGE,
            WPARAM(usize::from(on)),
            LPARAM(0),
        )
    };

    if let Err(error) = posted {
        log(format!(
            "cannot ask the raw input listener about the mouse: {error}"
        ));
    }
}

/// Registers the mouse for the listener's window, or removes it. Runs on the
/// listener thread, which owns the window.
fn register_mouse(window: HWND, on: bool) {
    let device = if on {
        RAWINPUTDEVICE {
            usUsagePage: HID_USAGE_PAGE_GENERIC,
            usUsage: HID_USAGE_GENERIC_MOUSE,
            dwFlags: RIDEV_INPUTSINK,
            hwndTarget: window,
        }
    } else {
        // Removal names no window: the system insists on it.
        RAWINPUTDEVICE {
            usUsagePage: HID_USAGE_PAGE_GENERIC,
            usUsage: HID_USAGE_GENERIC_MOUSE,
            dwFlags: RIDEV_REMOVE,
            hwndTarget: HWND::default(),
        }
    };

    let registered =
        unsafe { RegisterRawInputDevices(&[device], size_of::<RAWINPUTDEVICE>() as u32) };

    // Losing it costs the menu its pointer, not the menu: it still opens, and
    // letting go in the centre still calls it off.
    if let Err(error) = registered {
        log(format!("raw input cannot watch the mouse: {error}"));
    }
}

/// Whether the radial menu's combination is still held — every key of it.
pub fn radial_held() -> bool {
    let Some((key, modifiers)) = radial_binding() else {
        return false;
    };

    is_down(key) && held_modifiers().contains(modifiers)
}

/// Whether a key going up is one of the radial menu's combination.
fn releases_radial(key: u16) -> bool {
    let Some((bound, modifiers)) = radial_binding() else {
        return false;
    };

    if key == bound {
        return true;
    }

    // Raw input names a modifier by its generic key or by its side, depending
    // on the keyboard and the driver: both are taken.
    (modifiers.contains(Modifiers::ALT) && [VK_MENU, VK_LMENU, VK_RMENU].iter().any(|k| k.0 == key))
        || (modifiers.contains(Modifiers::CONTROL)
            && [VK_CONTROL, VK_LCONTROL, VK_RCONTROL]
                .iter()
                .any(|k| k.0 == key))
        || (modifiers.contains(Modifiers::SHIFT)
            && [VK_SHIFT, VK_LSHIFT, VK_RSHIFT].iter().any(|k| k.0 == key))
        || (modifiers.contains(Modifiers::SUPER) && [VK_LWIN, VK_RWIN].iter().any(|k| k.0 == key))
}

fn radial_binding() -> Option<(u16, Modifiers)> {
    let bindings = BINDINGS.lock().ok()?;

    bindings
        .iter()
        .find(|binding| binding.action == Action::Radial)
        .map(|binding| (binding.key, binding.modifiers))
}

/// The modifiers held right now. Read from the keyboard state rather than
/// tracked from the raw stream: this cannot drift out of sync when a key goes
/// down while another application is being switched to.
fn held_modifiers() -> Modifiers {
    let mut modifiers = Modifiers::empty();

    if is_down(VK_CONTROL.0) {
        modifiers |= Modifiers::CONTROL;
    }
    if is_down(VK_SHIFT.0) {
        modifiers |= Modifiers::SHIFT;
    }
    if is_down(VK_MENU.0) {
        modifiers |= Modifiers::ALT;
    }
    if is_down(VK_LWIN.0) || is_down(VK_RWIN.0) {
        modifiers |= Modifiers::SUPER;
    }

    modifiers
}

fn is_down(key: u16) -> bool {
    // The high bit means "down now"; the low bit is the toggle state, which
    // matters for Caps Lock and not here.
    (unsafe { GetAsyncKeyState(key as i32) } as u16 & 0x8000) != 0
}

/// Virtual key code for a physical key, following the US layout the way
/// `RegisterHotKey` does — so both paths answer to the same physical key.
fn virtual_key(code: Code) -> Option<u16> {
    let key = match code {
        Code::KeyA => 0x41,
        Code::KeyB => 0x42,
        Code::KeyC => 0x43,
        Code::KeyD => 0x44,
        Code::KeyE => 0x45,
        Code::KeyF => 0x46,
        Code::KeyG => 0x47,
        Code::KeyH => 0x48,
        Code::KeyI => 0x49,
        Code::KeyJ => 0x4A,
        Code::KeyK => 0x4B,
        Code::KeyL => 0x4C,
        Code::KeyM => 0x4D,
        Code::KeyN => 0x4E,
        Code::KeyO => 0x4F,
        Code::KeyP => 0x50,
        Code::KeyQ => 0x51,
        Code::KeyR => 0x52,
        Code::KeyS => 0x53,
        Code::KeyT => 0x54,
        Code::KeyU => 0x55,
        Code::KeyV => 0x56,
        Code::KeyW => 0x57,
        Code::KeyX => 0x58,
        Code::KeyY => 0x59,
        Code::KeyZ => 0x5A,

        Code::Digit0 => 0x30,
        Code::Digit1 => 0x31,
        Code::Digit2 => 0x32,
        Code::Digit3 => 0x33,
        Code::Digit4 => 0x34,
        Code::Digit5 => 0x35,
        Code::Digit6 => 0x36,
        Code::Digit7 => 0x37,
        Code::Digit8 => 0x38,
        Code::Digit9 => 0x39,

        Code::F1 => 0x70,
        Code::F2 => 0x71,
        Code::F3 => 0x72,
        Code::F4 => 0x73,
        Code::F5 => 0x74,
        Code::F6 => 0x75,
        Code::F7 => 0x76,
        Code::F8 => 0x77,
        Code::F9 => 0x78,
        Code::F10 => 0x79,
        Code::F11 => 0x7A,
        Code::F12 => 0x7B,

        Code::Numpad0 => 0x60,
        Code::Numpad1 => 0x61,
        Code::Numpad2 => 0x62,
        Code::Numpad3 => 0x63,
        Code::Numpad4 => 0x64,
        Code::Numpad5 => 0x65,
        Code::Numpad6 => 0x66,
        Code::Numpad7 => 0x67,
        Code::Numpad8 => 0x68,
        Code::Numpad9 => 0x69,
        Code::NumpadMultiply => 0x6A,
        Code::NumpadAdd => 0x6B,
        Code::NumpadSubtract => 0x6D,
        Code::NumpadDecimal => 0x6E,
        Code::NumpadDivide => 0x6F,
        Code::NumpadEnter => 0x0D,

        Code::ArrowLeft => 0x25,
        Code::ArrowUp => 0x26,
        Code::ArrowRight => 0x27,
        Code::ArrowDown => 0x28,
        Code::Home => 0x24,
        Code::End => 0x23,
        Code::PageUp => 0x21,
        Code::PageDown => 0x22,
        Code::Insert => 0x2D,
        Code::Delete => 0x2E,

        Code::Space => 0x20,
        Code::Enter => 0x0D,
        Code::Escape => 0x1B,
        Code::Backspace => 0x08,
        Code::Tab => 0x09,

        Code::Backquote => 0xC0,
        Code::Minus => 0xBD,
        Code::Equal => 0xBB,
        Code::BracketLeft => 0xDB,
        Code::BracketRight => 0xDD,
        Code::Backslash => 0xDC,
        Code::Semicolon => 0xBA,
        Code::Quote => 0xDE,
        Code::Comma => 0xBC,
        Code::Period => 0xBE,
        Code::Slash => 0xBF,

        _ => return None,
    };

    Some(key)
}
