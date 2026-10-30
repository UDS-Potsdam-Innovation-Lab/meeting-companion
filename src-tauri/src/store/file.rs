use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use super::{ensure_valid, MeetingStore, StoreError};
use crate::crypto::{self, DataKey, KeyProvider};
use crate::model::{self, is_valid_id, Meeting};

/// File name suffix of a stored (encrypted) meeting.
const EXT: &str = ".meeting";

/// A stored meeting is a few kilobytes; anything far larger is not ours and is not read.
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;

/// One file per meeting, `<id>.meeting`, in a directory on this device. The file holds the meeting
/// as JSON, encrypted with the data key from the OS keychain (see [`crate::crypto`]).
///
/// A save writes `.<id>.meeting.tmp`, flushes it to disk and renames it over `<id>.meeting`. The
/// rename replaces the file in one step, so a crash leaves either the old or the new version, never
/// half of one. Leftover temp files are ignored when reading.
pub struct FileMeetingStore {
    dir: PathBuf,
    key: DataKey,
    /// Serialises writes from concurrent commands.
    write_lock: Mutex<()>,
}

impl FileMeetingStore {
    /// Opens the store in `dir`, creating the directory if needed, with the data key from `keys`.
    ///
    /// On first start (no key, no meeting files) a new key is generated and put into the keychain.
    /// If the keychain cannot be used, or the key is missing while meeting files exist, this fails
    /// with [`StoreError::KeyUnavailable`] and touches nothing: no new key replaces a lost one, and
    /// no file is written or changed.
    pub fn open(dir: impl Into<PathBuf>, keys: &dyn KeyProvider) -> Result<Self, StoreError> {
        let dir = dir.into();
        fs::create_dir_all(&dir)?;
        let unavailable = |e: crypto::KeyError| {
            crate::log!("{e}");
            StoreError::KeyUnavailable
        };
        let key = match keys.load().map_err(unavailable)? {
            Some(key) => key,
            None => {
                if has_meeting_files(&dir)? {
                    crate::log!("encrypted meetings exist but the keychain has no key");
                    return Err(StoreError::KeyUnavailable);
                }
                let key = DataKey::generate();
                keys.store(&key).map_err(unavailable)?;
                // Only use a key the keychain demonstrably gives back.
                match keys.load().map_err(unavailable)? {
                    Some(stored) if stored == key => key,
                    _ => {
                        crate::log!("the keychain did not keep the new key");
                        return Err(StoreError::KeyUnavailable);
                    }
                }
            }
        };
        Ok(Self {
            dir,
            key,
            write_lock: Mutex::new(()),
        })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// The transcripts of these meetings: `<id>.transcript` files in the same folder, sealed with
    /// the same data key.
    pub fn transcripts(&self) -> crate::transcript::FileTranscriptStore {
        crate::transcript::FileTranscriptStore::new(self.dir.clone(), self.key.clone())
    }

    fn path_for(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}{EXT}"))
    }

    fn temp_path_for(&self, id: &str) -> PathBuf {
        self.dir.join(format!(".{id}{EXT}.tmp"))
    }

    /// Reads and checks one meeting file. Anything that is not a valid meeting with the id the file
    /// name promises is reported as corrupt; the file is only read, never changed.
    fn read_file(&self, path: &Path, id: &str) -> Result<Meeting, StoreError> {
        let corrupt = || StoreError::Corrupt {
            file: path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
        };
        let mut file = File::open(path)?;
        if file.metadata()?.len() > MAX_FILE_BYTES {
            return Err(corrupt());
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        let plain = crypto::open(&self.key, id, &bytes).ok_or_else(corrupt)?;
        let meeting: Meeting = serde_json::from_slice(&plain).map_err(|_| corrupt())?;
        if meeting.id != id || !model::validate(&meeting).is_empty() {
            return Err(corrupt());
        }
        Ok(meeting)
    }

    fn entries(&self) -> Result<Vec<(String, PathBuf, SystemTime)>, StoreError> {
        entries(&self.dir)
    }
}

fn has_meeting_files(dir: &Path) -> Result<bool, StoreError> {
    Ok(!entries(dir)?.is_empty())
}

/// `(id, path, modified)` of every `<id>.meeting` in the directory.
fn entries(dir: &Path) -> Result<Vec<(String, PathBuf, SystemTime)>, StoreError> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(id) = name.to_str().and_then(|n| n.strip_suffix(EXT)) else {
            continue;
        };
        if !is_valid_id(id) {
            continue;
        }
        let meta = entry.metadata()?;
        if !meta.is_file() {
            continue;
        }
        let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        out.push((id.to_owned(), entry.path(), modified));
    }
    Ok(out)
}

impl MeetingStore for FileMeetingStore {
    fn save(&self, meeting: &Meeting) -> Result<(), StoreError> {
        ensure_valid(meeting)?;
        let json = zeroize::Zeroizing::new(
            serde_json::to_vec(meeting).map_err(|e| StoreError::Io(std::io::Error::other(e)))?,
        );
        let sealed = crypto::seal(&self.key, &meeting.id, &json);

        let _guard = self.write_lock.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = self.temp_path_for(&meeting.id);
        let result = (|| {
            let mut f = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&tmp)?;
            f.write_all(&sealed)?;
            f.sync_all()?;
            drop(f);
            fs::rename(&tmp, self.path_for(&meeting.id))?;
            sync_dir(&self.dir);
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        result
    }

    fn load(&self, id: &str) -> Result<Option<Meeting>, StoreError> {
        if !is_valid_id(id) {
            return Ok(None);
        }
        let path = self.path_for(id);
        if !path.is_file() {
            return Ok(None);
        }
        self.read_file(&path, id).map(Some)
    }

    fn latest(&self) -> Result<Option<Meeting>, StoreError> {
        let newest = self
            .entries()?
            .into_iter()
            .max_by(|a, b| a.2.cmp(&b.2).then_with(|| a.0.cmp(&b.0)));
        match newest {
            None => Ok(None),
            Some((id, path, _)) => self.read_file(&path, &id).map(Some),
        }
    }
}

/// Makes the rename itself durable where the OS supports syncing a directory.
fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    if let Ok(d) = File::open(dir) {
        let _ = d.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::MemoryKeyProvider;
    use crate::model::tests::{running, sample};
    use std::time::Duration;

    fn store() -> (tempfile::TempDir, MemoryKeyProvider, FileMeetingStore) {
        let dir = tempfile::tempdir().unwrap();
        let keys = MemoryKeyProvider::new();
        let store = FileMeetingStore::open(dir.path().join("meetings"), &keys).unwrap();
        (dir, keys, store)
    }

    fn files(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    fn contains(haystack: &[u8], needle: &str) -> bool {
        haystack
            .windows(needle.len())
            .any(|w| w == needle.as_bytes())
    }

    #[test]
    fn writes_one_file_per_meeting_and_no_temp_file_remains() {
        let (_d, _k, store) = store();
        let a = sample();
        let mut b = sample();
        b.id = "m-2".into();
        store.save(&a).unwrap();
        store.save(&b).unwrap();
        store.save(&a).unwrap();
        assert_eq!(files(store.dir()), vec!["m-1.meeting", "m-2.meeting"]);
        assert_eq!(store.load("m-1").unwrap(), Some(a));
    }

    #[test]
    fn nothing_readable_is_on_disk() {
        let (_d, _k, store) = store();
        let mut m = sample();
        m.title = "Quarterly budget review".into();
        store.save(&m).unwrap();
        let bytes = fs::read(store.dir().join("m-1.meeting")).unwrap();
        assert!(bytes.starts_with(crypto::MAGIC));
        for plain in [
            "Quarterly budget review",
            "Mara Klein",
            "Tobias Brandt",
            "Check-in",
            "title",
            "10:00",
        ] {
            assert!(!contains(&bytes, plain), "{plain} is readable on disk");
        }
    }

    #[test]
    fn reopening_the_store_returns_the_latest_meeting_with_all_fields() {
        let (d, keys, store) = store();
        let mut older = sample();
        older.id = "m-old".into();
        store.save(&older).unwrap();
        std::thread::sleep(Duration::from_millis(20));
        let mut m = sample();
        m.title = "<img src=x onerror=alert(1)>".into();
        m.items[0].outcome = "A launch date everyone commits to".into();
        m.updated_at = 1_700_000_000_000;
        store.save(&m).unwrap();
        drop(store);

        let reopened = FileMeetingStore::open(d.path().join("meetings"), &keys).unwrap();
        assert_eq!(reopened.latest().unwrap(), Some(m));
        assert_eq!(reopened.load("m-old").unwrap(), Some(older));
    }

    #[test]
    fn running_meeting_survives_a_restart_and_an_invalid_run_is_never_written() {
        let (d, keys, store) = store();
        let m = running();
        store.save(&m).unwrap();
        let mut bad = m.clone();
        bad.run.as_mut().unwrap().items[0].ended_at = None;
        assert!(matches!(store.save(&bad), Err(StoreError::Invalid(_))));
        drop(store);

        let reopened = FileMeetingStore::open(d.path().join("meetings"), &keys).unwrap();
        assert_eq!(reopened.latest().unwrap(), Some(m));
    }

    #[test]
    fn editing_an_older_meeting_makes_it_the_latest() {
        let (_d, _k, store) = store();
        let a = sample();
        let mut b = sample();
        b.id = "m-2".into();
        store.save(&a).unwrap();
        std::thread::sleep(Duration::from_millis(20));
        store.save(&b).unwrap();
        std::thread::sleep(Duration::from_millis(20));
        store.save(&a).unwrap();
        assert_eq!(store.latest().unwrap().unwrap().id, "m-1");
    }

    #[test]
    fn invalid_meeting_is_never_written() {
        let (_d, _k, store) = store();
        let mut m = sample();
        m.end = "09:00".into();
        assert!(matches!(store.save(&m), Err(StoreError::Invalid(_))));
        assert!(files(store.dir()).is_empty());
    }

    #[test]
    fn corrupt_latest_file_is_reported_and_left_untouched() {
        let (_d, _k, store) = store();
        store.save(&sample()).unwrap();
        std::thread::sleep(Duration::from_millis(20));
        let path = store.dir().join("m-broken.meeting");
        let garbage = b"MCMEET01 half a file";
        fs::write(&path, garbage).unwrap();

        match store.latest() {
            Err(StoreError::Corrupt { file }) => assert_eq!(file, "m-broken.meeting"),
            other => panic!("expected Corrupt, got {other:?}"),
        }
        assert_eq!(fs::read(&path).unwrap(), garbage);
    }

    #[test]
    fn tampered_file_is_rejected_and_left_untouched() {
        let (_d, _k, store) = store();
        store.save(&sample()).unwrap();
        let path = store.dir().join("m-1.meeting");
        let mut bytes = fs::read(&path).unwrap();
        let last = bytes.len() - 20;
        bytes[last] ^= 0x01;
        fs::write(&path, &bytes).unwrap();
        assert!(matches!(store.latest(), Err(StoreError::Corrupt { .. })));
        assert!(matches!(store.load("m-1"), Err(StoreError::Corrupt { .. })));
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }

    #[test]
    fn a_file_copied_over_another_meeting_is_rejected() {
        let (_d, _k, store) = store();
        let mut other = sample();
        other.id = "m-2".into();
        store.save(&sample()).unwrap();
        store.save(&other).unwrap();
        fs::copy(
            store.dir().join("m-2.meeting"),
            store.dir().join("m-1.meeting"),
        )
        .unwrap();
        assert!(matches!(store.load("m-1"), Err(StoreError::Corrupt { .. })));
    }

    #[test]
    fn valid_ciphertext_of_an_invalid_meeting_counts_as_corrupt() {
        let (_d, keys, store) = store();
        let mut m = sample();
        m.end = "09:00".into();
        let key = keys.current().unwrap();
        let sealed = crypto::seal(&key, "m-1", &serde_json::to_vec(&m).unwrap());
        fs::write(store.dir().join("m-1.meeting"), sealed).unwrap();
        assert!(matches!(store.latest(), Err(StoreError::Corrupt { .. })));
    }

    #[test]
    fn leftover_temp_file_from_a_crash_is_ignored() {
        let (_d, _k, store) = store();
        let m = sample();
        store.save(&m).unwrap();
        std::thread::sleep(Duration::from_millis(20));
        fs::write(store.dir().join(".m-1.meeting.tmp"), b"MCMEET01").unwrap();
        assert_eq!(store.latest().unwrap(), Some(m.clone()));
        store.save(&m).unwrap();
        assert_eq!(files(store.dir()), vec!["m-1.meeting"]);
    }

    #[test]
    fn failed_write_keeps_the_previous_version() {
        let (_d, _k, store) = store();
        let m = sample();
        store.save(&m).unwrap();
        let before = fs::read(store.dir().join("m-1.meeting")).unwrap();
        // A directory where the temp file should go makes the write fail on every OS.
        fs::create_dir(store.dir().join(".m-1.meeting.tmp")).unwrap();
        let mut changed = m.clone();
        changed.title = "Changed".into();
        assert!(matches!(store.save(&changed), Err(StoreError::Io(_))));
        assert_eq!(fs::read(store.dir().join("m-1.meeting")).unwrap(), before);
    }

    #[test]
    fn unknown_ids_and_foreign_files_are_ignored() {
        let (_d, _k, store) = store();
        fs::write(store.dir().join("notes.txt"), b"hello").unwrap();
        fs::write(store.dir().join("bad name.meeting"), b"{}").unwrap();
        fs::write(store.dir().join("m-1.json"), b"{}").unwrap();
        assert!(store.latest().unwrap().is_none());
        assert!(store.load("../etc/passwd").unwrap().is_none());
    }

    #[test]
    fn first_start_generates_a_key_and_puts_it_in_the_keychain() {
        let dir = tempfile::tempdir().unwrap();
        let keys = MemoryKeyProvider::new();
        assert!(keys.current().is_none());
        FileMeetingStore::open(dir.path(), &keys).unwrap();
        let key = keys.current().expect("key stored");
        // The next start uses the same key.
        let store = FileMeetingStore::open(dir.path(), &keys).unwrap();
        store.save(&sample()).unwrap();
        assert_eq!(keys.current(), Some(key));
    }

    #[test]
    fn missing_key_with_existing_files_refuses_to_open_and_touches_nothing() {
        let (d, _k, store) = store();
        store.save(&sample()).unwrap();
        let dir = store.dir().to_path_buf();
        let before = fs::read(dir.join("m-1.meeting")).unwrap();
        drop(store);

        let empty = MemoryKeyProvider::new();
        assert!(matches!(
            FileMeetingStore::open(&dir, &empty),
            Err(StoreError::KeyUnavailable)
        ));
        // No replacement key was created, no file was changed.
        assert!(empty.current().is_none());
        assert_eq!(files(&dir), vec!["m-1.meeting"]);
        assert_eq!(fs::read(dir.join("m-1.meeting")).unwrap(), before);
        drop(d);
    }

    #[test]
    fn unavailable_keychain_refuses_to_open_and_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let keys = MemoryKeyProvider::unavailable();
        assert!(matches!(
            FileMeetingStore::open(dir.path(), &keys),
            Err(StoreError::KeyUnavailable)
        ));
        assert!(files(dir.path()).is_empty());
    }

    #[test]
    fn another_key_cannot_read_the_files() {
        let (_d, _k, store) = store();
        store.save(&sample()).unwrap();
        let dir = store.dir().to_path_buf();
        let other = MemoryKeyProvider::with_key(DataKey::generate());
        let reopened = FileMeetingStore::open(&dir, &other).unwrap();
        assert!(matches!(reopened.latest(), Err(StoreError::Corrupt { .. })));
    }
}
