//! Where meetings are kept. The app talks to [`MeetingStore`] only; [`FileMeetingStore`] is the real
//! implementation and [`MemoryMeetingStore`] the fake for tests and the smoke run.

mod file;
mod locked;
mod memory;

pub use file::FileMeetingStore;
pub use locked::LockedMeetingStore;
pub use memory::MemoryMeetingStore;

use crate::model::{self, FieldError, Meeting};

#[derive(Debug)]
pub enum StoreError {
    /// The meeting failed validation and was not written.
    Invalid(Vec<FieldError>),
    /// A stored meeting could not be decrypted (changed, or sealed with another key), parsed or
    /// validated. The file is left as it is.
    Corrupt { file: String },
    /// The data key is not available from the OS keychain. Nothing is read or written.
    KeyUnavailable,
    /// The file system refused a read or a write.
    Io(std::io::Error),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Invalid(errs) => write!(f, "meeting is invalid ({} errors)", errs.len()),
            StoreError::Corrupt { file } => write!(f, "stored meeting {file} is unreadable"),
            StoreError::KeyUnavailable => write!(f, "the data key is not available"),
            StoreError::Io(e) => write!(f, "storage error: {e}"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<std::io::Error> for StoreError {
    fn from(e: std::io::Error) -> Self {
        StoreError::Io(e)
    }
}

pub trait MeetingStore: Send + Sync {
    /// Validates and stores the meeting, replacing an earlier version with the same id.
    /// Invalid meetings are rejected with [`StoreError::Invalid`] and nothing is written.
    fn save(&self, meeting: &Meeting) -> Result<(), StoreError>;

    /// The meeting with this id, if it exists.
    fn load(&self, id: &str) -> Result<Option<Meeting>, StoreError>;

    /// The most recently saved meeting, if any.
    fn latest(&self) -> Result<Option<Meeting>, StoreError>;
}

/// The check every implementation runs before it writes.
fn ensure_valid(meeting: &Meeting) -> Result<(), StoreError> {
    let errs = model::validate(meeting);
    if errs.is_empty() {
        Ok(())
    } else {
        Err(StoreError::Invalid(errs))
    }
}
