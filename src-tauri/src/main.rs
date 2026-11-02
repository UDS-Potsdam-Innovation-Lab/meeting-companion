// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// macOS asks for the microphone only for a binary that declares why (NSMicrophoneUsageDescription).
// A bundled app carries it in Contents/Info.plist; the binary built without a bundle
// (`npm run tauri build -- --no-bundle`) carries src-tauri/Info.plist in its `__TEXT,__info_plist`
// section instead. `tauri dev` builds (cfg `dev`, set by tauri-build) get the same file embedded by
// `tauri::generate_context!`; embedding it twice would define `_EMBED_INFO_PLIST` twice, so this one is
// for the other builds only. CI checks the release binary with `node scripts/plist-check.mjs`.
#[cfg(all(target_os = "macos", not(dev)))]
tauri::embed_plist::embed_info_plist!("../Info.plist");

fn main() {
    meeting_companion_lib::run()
}
