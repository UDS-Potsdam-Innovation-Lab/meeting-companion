use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use super::{ensure_valid, MeetingStore, StoreError};
use crate::model::{self, is_valid_id, Meeting};

/// A stored meeting is a few kilobytes; anything far larger is not ours and is not read.
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;

/// One JSON file per meeting, `<id>.json`, in a directory on this device.
///
/// A save writes `.<id>.json.tmp`, flushes it to disk and renames it over `<id>.json`. The rename
/// replaces the file in one step, so a crash leaves either the old or the new version, never half
/// of one. Leftover temp files are ignored when reading.
pub struct FileMeetingStore {
    dir: PathBuf,
    /// Serialises writes from concurrent commands.
    write_lock: Mutex<()>,
}

impl FileMeetingStore {
    /// Opens the store in `dir`, creating the directory if needed.
    pub fn open(dir: impl Into<PathBuf>) -> Result<Self, StoreError> {
        let dir = dir.into();
        fs::create_dir_all(&dir)?;
        Ok(Self {
            dir,
            write_lock: Mutex::new(()),
        })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn path_for(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.json"))
    }

    fn temp_path_for(&self, id: &str) -> PathBuf {
        self.dir.join(format!(".{id}.json.tmp"))
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
        let meeting: Meeting = serde_json::from_slice(&bytes).map_err(|_| corrupt())?;
        if meeting.id != id || !model::validate(&meeting).is_empty() {
            return Err(corrupt());
        }
        Ok(meeting)
    }

    /// `(id, path, modified)` of every `<id>.json` in the directory.
    fn entries(&self) -> Result<Vec<(String, PathBuf, SystemTime)>, StoreError> {
        let mut out = Vec::new();
        for entry in fs::read_dir(&self.dir)? {
            let entry = entry?;
            let name = entry.file_name();
            let Some(id) = name.to_str().and_then(|n| n.strip_suffix(".json")) else {
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
}

impl MeetingStore for FileMeetingStore {
    fn save(&self, meeting: &Meeting) -> Result<(), StoreError> {
        ensure_valid(meeting)?;
        let json = serde_json::to_vec_pretty(meeting)
            .map_err(|e| StoreError::Io(std::io::Error::other(e)))?;

        let _guard = self.write_lock.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = self.temp_path_for(&meeting.id);
        let result = (|| {
            let mut f = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&tmp)?;
            f.write_all(&json)?;
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
    use crate::model::tests::sample;
    use std::time::Duration;

    fn store() -> (tempfile::TempDir, FileMeetingStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = FileMeetingStore::open(dir.path().join("meetings")).unwrap();
        (dir, store)
    }

    fn files(store: &FileMeetingStore) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(store.dir())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn writes_one_json_file_per_meeting_and_no_temp_file_remains() {
        let (_d, store) = store();
        let a = sample();
        let mut b = sample();
        b.id = "m-2".into();
        store.save(&a).unwrap();
        store.save(&b).unwrap();
        store.save(&a).unwrap();
        assert_eq!(files(&store), vec!["m-1.json", "m-2.json"]);
        let on_disk: Meeting =
            serde_json::from_slice(&fs::read(store.dir().join("m-1.json")).unwrap()).unwrap();
        assert_eq!(on_disk, a);
    }

    #[test]
    fn reopening_the_store_returns_the_latest_meeting_with_all_fields() {
        let (d, store) = store();
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

        let reopened = FileMeetingStore::open(d.path().join("meetings")).unwrap();
        assert_eq!(reopened.latest().unwrap(), Some(m));
        assert_eq!(reopened.load("m-old").unwrap(), Some(older));
    }

    #[test]
    fn editing_an_older_meeting_makes_it_the_latest() {
        let (_d, store) = store();
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
        let (_d, store) = store();
        let mut m = sample();
        m.end = "09:00".into();
        assert!(matches!(store.save(&m), Err(StoreError::Invalid(_))));
        assert!(files(&store).is_empty());
    }

    #[test]
    fn corrupt_latest_file_is_reported_and_left_untouched() {
        let (_d, store) = store();
        store.save(&sample()).unwrap();
        std::thread::sleep(Duration::from_millis(20));
        let path = store.dir().join("m-broken.json");
        let garbage = b"{\"version\":1,\"id\":\"m-broken\",\"title\":\"half a fi";
        fs::write(&path, garbage).unwrap();

        match store.latest() {
            Err(StoreError::Corrupt { file }) => assert_eq!(file, "m-broken.json"),
            other => panic!("expected Corrupt, got {other:?}"),
        }
        assert_eq!(fs::read(&path).unwrap(), garbage);
        assert!(path.exists());
    }

    #[test]
    fn well_formed_json_that_breaks_the_rules_counts_as_corrupt() {
        let (_d, store) = store();
        let mut m = sample();
        m.end = "09:00".into();
        let path = store.dir().join("m-1.json");
        fs::write(&path, serde_json::to_vec(&m).unwrap()).unwrap();
        assert!(matches!(store.latest(), Err(StoreError::Corrupt { .. })));

        let mut other = sample();
        other.id = "m-other".into();
        fs::write(&path, serde_json::to_vec(&other).unwrap()).unwrap();
        assert!(matches!(store.load("m-1"), Err(StoreError::Corrupt { .. })));
    }

    #[test]
    fn leftover_temp_file_from_a_crash_is_ignored() {
        let (_d, store) = store();
        let m = sample();
        store.save(&m).unwrap();
        std::thread::sleep(Duration::from_millis(20));
        fs::write(store.dir().join(".m-1.json.tmp"), b"{\"version\":1,\"id\":").unwrap();
        assert_eq!(store.latest().unwrap(), Some(m.clone()));
        // The next save simply replaces the leftover.
        store.save(&m).unwrap();
        assert_eq!(files(&store), vec!["m-1.json"]);
    }

    #[test]
    fn failed_write_keeps_the_previous_version() {
        let (_d, store) = store();
        let m = sample();
        store.save(&m).unwrap();
        let before = fs::read(store.dir().join("m-1.json")).unwrap();
        // A directory where the temp file should go makes the write fail on every OS.
        fs::create_dir(store.dir().join(".m-1.json.tmp")).unwrap();
        let mut changed = m.clone();
        changed.title = "Changed".into();
        assert!(matches!(store.save(&changed), Err(StoreError::Io(_))));
        assert_eq!(fs::read(store.dir().join("m-1.json")).unwrap(), before);
    }

    #[test]
    fn unknown_ids_and_foreign_files_are_ignored() {
        let (_d, store) = store();
        fs::write(store.dir().join("notes.txt"), b"hello").unwrap();
        fs::write(store.dir().join("bad name.json"), b"{}").unwrap();
        assert!(store.latest().unwrap().is_none());
        assert!(store.load("../etc/passwd").unwrap().is_none());
    }
}
