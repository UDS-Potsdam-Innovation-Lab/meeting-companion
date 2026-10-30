use super::{MeetingStore, StoreError};
use crate::model::Meeting;

/// Used when the data key is not available: every call fails with [`StoreError::KeyUnavailable`],
/// so stored meetings stay untouched and nothing new is written unencrypted.
#[derive(Default)]
pub struct LockedMeetingStore;

impl MeetingStore for LockedMeetingStore {
    fn save(&self, _meeting: &Meeting) -> Result<(), StoreError> {
        Err(StoreError::KeyUnavailable)
    }

    fn load(&self, _id: &str) -> Result<Option<Meeting>, StoreError> {
        Err(StoreError::KeyUnavailable)
    }

    fn latest(&self) -> Result<Option<Meeting>, StoreError> {
        Err(StoreError::KeyUnavailable)
    }
}
