use std::sync::Mutex;

use super::{ensure_valid, MeetingStore, StoreError};
use crate::model::Meeting;

/// Keeps meetings in memory only. Used by tests and by the smoke run of the built app.
#[derive(Default)]
pub struct MemoryMeetingStore {
    /// Meetings in save order; the last entry is the most recently saved one.
    meetings: Mutex<Vec<Meeting>>,
}

impl MemoryMeetingStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl MeetingStore for MemoryMeetingStore {
    fn save(&self, meeting: &Meeting) -> Result<(), StoreError> {
        ensure_valid(meeting)?;
        let mut all = self.meetings.lock().unwrap_or_else(|e| e.into_inner());
        all.retain(|m| m.id != meeting.id);
        all.push(meeting.clone());
        Ok(())
    }

    fn load(&self, id: &str) -> Result<Option<Meeting>, StoreError> {
        let all = self.meetings.lock().unwrap_or_else(|e| e.into_inner());
        Ok(all.iter().find(|m| m.id == id).cloned())
    }

    fn latest(&self) -> Result<Option<Meeting>, StoreError> {
        let all = self.meetings.lock().unwrap_or_else(|e| e.into_inner());
        Ok(all.last().cloned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::tests::sample;

    #[test]
    fn latest_is_the_last_saved() {
        let store = MemoryMeetingStore::new();
        assert!(store.latest().unwrap().is_none());
        let a = sample();
        let mut b = sample();
        b.id = "m-2".into();
        store.save(&a).unwrap();
        store.save(&b).unwrap();
        assert_eq!(store.latest().unwrap().unwrap().id, "m-2");
        store.save(&a).unwrap();
        assert_eq!(store.latest().unwrap().unwrap().id, "m-1");
        assert_eq!(store.load("m-2").unwrap(), Some(b));
    }

    #[test]
    fn rejects_invalid_meeting() {
        let store = MemoryMeetingStore::new();
        let mut m = sample();
        m.title = String::new();
        assert!(matches!(store.save(&m), Err(StoreError::Invalid(_))));
        assert!(store.latest().unwrap().is_none());
    }
}
