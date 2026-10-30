//! Meeting Companion core: the meeting model, the store and the Tauri commands the UI calls.
//!
//! The app opens no network port and makes no network request. The UI is served from the app's
//! own assets through Tauri's custom protocol, and every command below reads or writes local files.

pub mod engines;
pub mod model;
pub mod store;

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{Manager, State};

use model::{FieldError, Meeting};
use store::{FileMeetingStore, MeetingStore, MemoryMeetingStore, StoreError};

/// `MEETING_COMPANION_STORE=memory` keeps meetings in memory only (tests, demos).
pub const ENV_STORE: &str = "MEETING_COMPANION_STORE";
/// `MEETING_COMPANION_SMOKE=1` starts the app with the in-memory store, waits until the UI reports
/// that the agenda setup view rendered, prints `SMOKE OK` and exits 0 (or exits 1 after a timeout).
pub const ENV_SMOKE: &str = "MEETING_COMPANION_SMOKE";
const SMOKE_TIMEOUT: Duration = Duration::from_secs(90);
const SMOKE_VIEW: &str = "agenda-setup";

pub struct AppState {
    store: Box<dyn MeetingStore>,
    smoke: bool,
}

/// What the UI gets on start: the latest meeting, or why it could not be read.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoadResult {
    pub meeting: Option<Meeting>,
    /// `corrupt` (the file is not a valid meeting) or `unreadable` (the OS refused the read).
    pub error: Option<&'static str>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SaveError {
    Invalid { fields: Vec<FieldError> },
    Io,
}

pub fn load_latest(store: &dyn MeetingStore) -> LoadResult {
    match store.latest() {
        Ok(meeting) => LoadResult {
            meeting,
            error: None,
        },
        Err(e) => {
            // Only the kind of failure is logged, never meeting content.
            eprintln!("meeting-companion: could not open the latest meeting: {e}");
            LoadResult {
                meeting: None,
                error: Some(match e {
                    StoreError::Io(_) => "unreadable",
                    _ => "corrupt",
                }),
            }
        }
    }
}

/// Stamps the save time and stores the meeting. Returns the stamp.
pub fn save(store: &dyn MeetingStore, mut meeting: Meeting, now_ms: u64) -> Result<u64, SaveError> {
    meeting.updated_at = now_ms;
    match store.save(&meeting) {
        Ok(()) => Ok(now_ms),
        Err(StoreError::Invalid(fields)) => Err(SaveError::Invalid { fields }),
        Err(e) => {
            eprintln!("meeting-companion: could not save the meeting: {e}");
            Err(SaveError::Io)
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

#[tauri::command]
fn load_latest_meeting(state: State<'_, AppState>) -> LoadResult {
    load_latest(state.store.as_ref())
}

#[tauri::command]
fn save_meeting(state: State<'_, AppState>, meeting: Meeting) -> Result<u64, SaveError> {
    save(state.store.as_ref(), meeting, now_ms())
}

/// The UI calls this once a view has rendered. Only the smoke run acts on it.
#[tauri::command]
fn view_ready(app: tauri::AppHandle, state: State<'_, AppState>, view: String) {
    if !state.smoke {
        return;
    }
    if view == SMOKE_VIEW {
        println!("SMOKE OK: {SMOKE_VIEW} rendered");
        app.exit(0);
    } else {
        eprintln!("SMOKE FAIL: unexpected view");
        app.exit(1);
    }
}

fn env_flag(name: &str) -> bool {
    std::env::var(name).is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let smoke = env_flag(ENV_SMOKE);
            let memory = smoke || std::env::var(ENV_STORE).is_ok_and(|v| v == "memory");
            let store: Box<dyn MeetingStore> = if memory {
                Box::new(MemoryMeetingStore::new())
            } else {
                let dir = app.path().app_data_dir()?.join("meetings");
                Box::new(FileMeetingStore::open(dir)?)
            };
            app.manage(AppState { store, smoke });
            if smoke {
                std::thread::spawn(|| {
                    std::thread::sleep(SMOKE_TIMEOUT);
                    eprintln!(
                        "SMOKE FAIL: the agenda setup view did not report within the timeout"
                    );
                    std::process::exit(1);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_latest_meeting,
            save_meeting,
            view_ready
        ])
        .run(tauri::generate_context!())
        .expect("error while running Meeting Companion");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::tests::sample;

    #[test]
    fn load_latest_reports_corrupt_file_and_returns_no_meeting() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileMeetingStore::open(dir.path()).unwrap();
        std::fs::write(dir.path().join("m-1.json"), b"not json").unwrap();
        assert_eq!(
            load_latest(&store),
            LoadResult {
                meeting: None,
                error: Some("corrupt")
            }
        );
        assert_eq!(
            std::fs::read(dir.path().join("m-1.json")).unwrap(),
            b"not json"
        );
    }

    #[test]
    fn save_stamps_time_and_load_returns_it() {
        let store = MemoryMeetingStore::new();
        assert_eq!(save(&store, sample(), 42), Ok(42));
        let loaded = load_latest(&store);
        assert_eq!(loaded.error, None);
        assert_eq!(loaded.meeting.unwrap().updated_at, 42);
    }

    #[test]
    fn save_returns_field_errors_for_invalid_meeting() {
        let store = MemoryMeetingStore::new();
        let mut m = sample();
        m.title.clear();
        match save(&store, m, 1) {
            Err(SaveError::Invalid { fields }) => assert_eq!(fields[0].field, "title"),
            other => panic!("expected Invalid, got {other:?}"),
        }
        assert!(load_latest(&store).meeting.is_none());
    }

    #[test]
    fn save_error_serialises_with_a_kind_tag() {
        let json = serde_json::to_value(SaveError::Io).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "io" }));
    }
}
