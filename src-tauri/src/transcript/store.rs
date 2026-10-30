//! Where transcripts are kept: `<app_data>/meetings/<id>.transcript`, next to the meeting file.
//!
//! The file is append-only: `MAGIC (8 bytes)`, then one sealed record per final segment:
//! `length (u32 LE) || nonce (24) || ciphertext + tag (16)`. Each record is the segment as JSON,
//! encrypted with the data key ([`crate::crypto::seal_with`]); its associated data is
//! `MAGIC || meeting id || 0x00 || sequence number (u64 LE)`, so a record that was changed, moved to
//! another position or copied in from another meeting's transcript fails to open.
//!
//! Every record is written and flushed to disk (`sync_data`) as soon as its segment is final, so a
//! crash loses at most the segment being spoken. A record cut off by a crash or power loss at the
//! end of the file is ignored when reading, and cut away before the next append. The writer holds only
//! the file, the next sequence number and the last offset, never the transcript text.

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use super::{Segment, TEXT_MAX};
use crate::crypto::{self, DataKey, SEAL_OVERHEAD};
use crate::model::is_valid_id;

pub const MAGIC: &[u8; 8] = b"MCTRAN01";
pub const EXT: &str = ".transcript";
/// A record is one segment of at most 2 000 characters; anything far larger is not ours.
const MAX_RECORD: usize = 64 * 1024;
const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug)]
pub enum TranscriptError {
    /// A record was changed, reordered, belongs to another meeting or is not ours. The file is left
    /// as it is.
    Corrupt,
    /// The data key is not available; nothing is read or written.
    KeyUnavailable,
    /// Not a valid meeting id.
    InvalidId,
    Io(std::io::Error),
}

impl std::fmt::Display for TranscriptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TranscriptError::Corrupt => f.write_str("stored transcript is unreadable"),
            TranscriptError::KeyUnavailable => f.write_str("the data key is not available"),
            TranscriptError::InvalidId => f.write_str("invalid meeting id"),
            // Only the kind: an io::Error's text could name paths but never content.
            TranscriptError::Io(e) => write!(f, "transcript storage error: {:?}", e.kind()),
        }
    }
}

impl From<std::io::Error> for TranscriptError {
    fn from(e: std::io::Error) -> Self {
        TranscriptError::Io(e)
    }
}

pub trait TranscriptStore: Send + Sync {
    /// Every final segment stored for the meeting, in order. Empty if there is none.
    fn load(&self, id: &str) -> Result<Vec<Segment>, TranscriptError>;
    /// Opens the meeting's transcript for appending.
    fn writer(&self, id: &str) -> Result<Box<dyn TranscriptWriter>, TranscriptError>;
}

pub trait TranscriptWriter: Send {
    /// Appends one final segment and makes it durable before returning.
    fn append(&mut self, segment: &Segment) -> Result<(), TranscriptError>;
    /// End offset of the last stored segment (0 if none): where a resumed recording continues.
    fn last_end_ms(&self) -> u64;
}

fn record_aad(id: &str, seq: u64) -> Vec<u8> {
    let mut aad = MAGIC.to_vec();
    aad.extend_from_slice(id.as_bytes());
    aad.push(0);
    aad.extend_from_slice(&seq.to_le_bytes());
    aad
}

fn valid_segment(s: &Segment) -> bool {
    s.is_final && s.end_ms >= s.start_ms && s.text.chars().count() <= TEXT_MAX
}

/// Seals one segment as record number `seq` of meeting `id`.
pub fn seal_record(key: &DataKey, id: &str, seq: u64, segment: &Segment) -> Vec<u8> {
    let json =
        zeroize::Zeroizing::new(serde_json::to_vec(segment).expect("a segment always serialises"));
    let sealed = crypto::seal_with(key, &record_aad(id, seq), &json);
    let mut out = Vec::with_capacity(4 + sealed.len());
    out.extend_from_slice(&(sealed.len() as u32).to_le_bytes());
    out.extend_from_slice(&sealed);
    out
}

/// What reading a transcript file found.
struct Parsed {
    segments: Vec<Segment>,
    /// Bytes up to the end of the last complete record; anything after it is a torn tail.
    valid_len: u64,
}

fn read_file(key: &DataKey, id: &str, path: &Path) -> Result<Parsed, TranscriptError> {
    let mut bytes = Vec::new();
    match File::open(path) {
        Ok(mut f) => {
            if f.metadata()?.len() > MAX_FILE_BYTES {
                return Err(TranscriptError::Corrupt);
            }
            f.read_to_end(&mut bytes)?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    parse(key, id, &bytes)
}

fn parse(key: &DataKey, id: &str, bytes: &[u8]) -> Result<Parsed, TranscriptError> {
    if bytes.len() < MAGIC.len() {
        // Empty, or cut off while the header was written.
        return if MAGIC.starts_with(bytes) {
            Ok(Parsed {
                segments: Vec::new(),
                valid_len: 0,
            })
        } else {
            Err(TranscriptError::Corrupt)
        };
    }
    if &bytes[..MAGIC.len()] != MAGIC {
        return Err(TranscriptError::Corrupt);
    }
    let mut pos = MAGIC.len();
    let mut segments = Vec::new();
    loop {
        let rest = &bytes[pos..];
        if rest.len() < 4 {
            break; // complete, or a torn length field
        }
        let len = u32::from_le_bytes(rest[..4].try_into().unwrap_or([0; 4])) as usize;
        if !(SEAL_OVERHEAD..=MAX_RECORD).contains(&len) {
            return Err(TranscriptError::Corrupt);
        }
        if rest.len() < 4 + len {
            break; // torn last record
        }
        let seq = segments.len() as u64;
        let plain = crypto::open_with(key, &record_aad(id, seq), &rest[4..4 + len])
            .ok_or(TranscriptError::Corrupt)?;
        let segment: Segment =
            serde_json::from_slice(&plain).map_err(|_| TranscriptError::Corrupt)?;
        if !valid_segment(&segment) {
            return Err(TranscriptError::Corrupt);
        }
        segments.push(segment);
        pos += 4 + len;
    }
    Ok(Parsed {
        segments,
        valid_len: pos as u64,
    })
}

/// Transcripts as encrypted files in the meetings folder.
pub struct FileTranscriptStore {
    dir: PathBuf,
    key: DataKey,
}

impl FileTranscriptStore {
    pub fn new(dir: impl Into<PathBuf>, key: DataKey) -> Self {
        Self {
            dir: dir.into(),
            key,
        }
    }

    pub fn path_for(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}{EXT}"))
    }
}

impl TranscriptStore for FileTranscriptStore {
    fn load(&self, id: &str) -> Result<Vec<Segment>, TranscriptError> {
        if !is_valid_id(id) {
            return Err(TranscriptError::InvalidId);
        }
        Ok(read_file(&self.key, id, &self.path_for(id))?.segments)
    }

    fn writer(&self, id: &str) -> Result<Box<dyn TranscriptWriter>, TranscriptError> {
        if !is_valid_id(id) {
            return Err(TranscriptError::InvalidId);
        }
        let path = self.path_for(id);
        let found = read_file(&self.key, id, &path)?;
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)?;
        let len = file.metadata()?.len();
        if found.valid_len < MAGIC.len() as u64 {
            // New file, or only a torn header: start it.
            file.set_len(0)?;
            file.write_all(MAGIC)?;
            file.sync_data()?;
        } else if len > found.valid_len {
            // Cut away a record torn by a crash, so the next one follows a complete record.
            file.set_len(found.valid_len)?;
            file.sync_data()?;
        }
        drop(file);
        let file = OpenOptions::new().append(true).open(&path)?;
        sync_dir(&self.dir);
        Ok(Box::new(FileTranscriptWriter {
            file,
            key: self.key.clone(),
            id: id.to_owned(),
            seq: found.segments.len() as u64,
            last_end_ms: found.segments.last().map_or(0, |s| s.end_ms),
        }))
    }
}

struct FileTranscriptWriter {
    file: File,
    key: DataKey,
    id: String,
    seq: u64,
    last_end_ms: u64,
}

impl TranscriptWriter for FileTranscriptWriter {
    fn append(&mut self, segment: &Segment) -> Result<(), TranscriptError> {
        let record = seal_record(&self.key, &self.id, self.seq, segment);
        self.file.write_all(&record)?;
        self.file.sync_data()?;
        self.seq += 1;
        self.last_end_ms = segment.end_ms;
        Ok(())
    }

    fn last_end_ms(&self) -> u64 {
        self.last_end_ms
    }
}

fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    if let Ok(d) = File::open(dir) {
        let _ = d.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
}

/// Keeps transcripts in memory (`MEETING_COMPANION_STORE=memory`, smoke run, tests).
#[derive(Default, Clone)]
pub struct MemoryTranscriptStore {
    all: Arc<Mutex<HashMap<String, Vec<Segment>>>>,
}

impl MemoryTranscriptStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl TranscriptStore for MemoryTranscriptStore {
    fn load(&self, id: &str) -> Result<Vec<Segment>, TranscriptError> {
        Ok(self
            .all
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .cloned()
            .unwrap_or_default())
    }

    fn writer(&self, id: &str) -> Result<Box<dyn TranscriptWriter>, TranscriptError> {
        let last_end_ms = self.load(id)?.last().map_or(0, |s| s.end_ms);
        Ok(Box::new(MemoryWriter {
            all: self.all.clone(),
            id: id.to_owned(),
            last_end_ms,
        }))
    }
}

struct MemoryWriter {
    all: Arc<Mutex<HashMap<String, Vec<Segment>>>>,
    id: String,
    last_end_ms: u64,
}

impl TranscriptWriter for MemoryWriter {
    fn append(&mut self, segment: &Segment) -> Result<(), TranscriptError> {
        self.all
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(self.id.clone())
            .or_default()
            .push(segment.clone());
        self.last_end_ms = segment.end_ms;
        Ok(())
    }

    fn last_end_ms(&self) -> u64 {
        self.last_end_ms
    }
}

/// Used when the data key is not available: nothing is read or written.
pub struct LockedTranscriptStore;

impl TranscriptStore for LockedTranscriptStore {
    fn load(&self, _id: &str) -> Result<Vec<Segment>, TranscriptError> {
        Err(TranscriptError::KeyUnavailable)
    }

    fn writer(&self, _id: &str) -> Result<Box<dyn TranscriptWriter>, TranscriptError> {
        Err(TranscriptError::KeyUnavailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcript::Lang;
    use std::fs;

    fn seg(i: u64, text: &str) -> Segment {
        Segment {
            start_ms: i * 3_000,
            end_ms: i * 3_000 + 2_500,
            at: 1_700_000_000_000 + i * 3_000,
            text: text.to_owned(),
            lang: if i.is_multiple_of(2) { Lang::De } else { Lang::En },
            is_final: true,
        }
    }

    fn store() -> (tempfile::TempDir, FileTranscriptStore) {
        let d = tempfile::tempdir().unwrap();
        let s = FileTranscriptStore::new(d.path(), DataKey::generate());
        (d, s)
    }

    fn contains(haystack: &[u8], needle: &str) -> bool {
        haystack
            .windows(needle.len())
            .any(|w| w == needle.as_bytes())
    }

    #[test]
    fn round_trip_of_many_records_across_writers() {
        let (_d, s) = store();
        let mut w = s.writer("m-1").unwrap();
        let all: Vec<Segment> = (0..500)
            .map(|i| seg(i, &format!("Zeile {i} – line {i}")))
            .collect();
        for x in &all[..300] {
            w.append(x).unwrap();
        }
        drop(w);
        // A second session appends after the first.
        let mut w = s.writer("m-1").unwrap();
        assert_eq!(w.last_end_ms(), all[299].end_ms);
        for x in &all[300..] {
            w.append(x).unwrap();
        }
        assert_eq!(s.load("m-1").unwrap(), all);
        assert!(s.load("m-2").unwrap().is_empty());
    }

    #[test]
    fn a_file_cut_in_the_middle_of_the_last_record_keeps_every_complete_record() {
        let (_d, s) = store();
        let mut w = s.writer("m-1").unwrap();
        for i in 0..5 {
            w.append(&seg(i, "complete")).unwrap();
        }
        drop(w);
        let path = s.path_for("m-1");
        let full = fs::read(&path).unwrap();
        let record = (full.len() - MAGIC.len()) / 5;
        for cut in [1, 3, 4, 10, record - 1] {
            fs::write(&path, &full[..full.len() - cut]).unwrap();
            let got = s.load("m-1").unwrap();
            assert_eq!(got.len(), 4, "cut {cut}");
        }
        // The next session cuts the torn tail away and appends after record 4.
        let mut w = s.writer("m-1").unwrap();
        w.append(&seg(9, "after the crash")).unwrap();
        let got = s.load("m-1").unwrap();
        assert_eq!(got.len(), 5);
        assert_eq!(got[4].text, "after the crash");
        // A header torn by a crash right at the start counts as empty.
        fs::write(&path, &MAGIC[..3]).unwrap();
        assert!(s.load("m-1").unwrap().is_empty());
        s.writer("m-1").unwrap().append(&seg(0, "fresh")).unwrap();
        assert_eq!(s.load("m-1").unwrap().len(), 1);
    }

    #[test]
    fn a_tampered_reordered_or_foreign_record_is_rejected() {
        let (_d, s) = store();
        let mut w = s.writer("m-1").unwrap();
        for i in 0..3 {
            w.append(&seg(i, "same length")).unwrap();
        }
        drop(w);
        let path = s.path_for("m-1");
        let good = fs::read(&path).unwrap();
        let rec = (good.len() - MAGIC.len()) / 3;
        let r = |i: usize| MAGIC.len() + i * rec..MAGIC.len() + (i + 1) * rec;

        // One flipped bit in a record.
        let mut bad = good.clone();
        bad[r(1).start + 30] ^= 1;
        fs::write(&path, &bad).unwrap();
        assert!(matches!(s.load("m-1"), Err(TranscriptError::Corrupt)));
        assert!(matches!(s.writer("m-1"), Err(TranscriptError::Corrupt)));
        // Left untouched.
        assert_eq!(fs::read(&path).unwrap(), bad);

        // Records 0 and 1 swapped.
        let mut swapped = good[..MAGIC.len()].to_vec();
        swapped.extend_from_slice(&good[r(1)]);
        swapped.extend_from_slice(&good[r(0)]);
        swapped.extend_from_slice(&good[r(2)]);
        fs::write(&path, &swapped).unwrap();
        assert!(matches!(s.load("m-1"), Err(TranscriptError::Corrupt)));

        // A record of another meeting (same key, same position) copied in.
        let mut other = s.writer("m-2").unwrap();
        for i in 0..3 {
            other.append(&seg(i, "same length")).unwrap();
        }
        drop(other);
        let foreign = fs::read(s.path_for("m-2")).unwrap();
        let mut mixed = good.clone();
        mixed[r(2)].copy_from_slice(&foreign[r(2)]);
        fs::write(&path, &mixed).unwrap();
        assert!(matches!(s.load("m-1"), Err(TranscriptError::Corrupt)));

        // A whole file of another meeting copied over this one.
        fs::write(&path, &foreign).unwrap();
        assert!(matches!(s.load("m-1"), Err(TranscriptError::Corrupt)));

        // Another key.
        fs::write(&path, &good).unwrap();
        let other_key = FileTranscriptStore::new(_d.path(), DataKey::generate());
        assert!(matches!(
            other_key.load("m-1"),
            Err(TranscriptError::Corrupt)
        ));
        assert_eq!(s.load("m-1").unwrap().len(), 3);
    }

    #[test]
    fn the_file_never_contains_transcript_text_in_plain_form() {
        let (_d, s) = store();
        let mut w = s.writer("m-1").unwrap();
        let phrases = [
            "Vertraulich: Budget 40000 Euro",
            "offline mode moves to January",
            "de",
            "text",
        ];
        for (i, p) in phrases.iter().enumerate() {
            w.append(&seg(i as u64, p)).unwrap();
        }
        let bytes = fs::read(s.path_for("m-1")).unwrap();
        assert!(bytes.starts_with(MAGIC));
        for p in [
            "Vertraulich",
            "Budget",
            "offline mode",
            "January",
            "\"text\"",
            "lang",
            "final",
        ] {
            assert!(!contains(&bytes, p), "{p} is readable on disk");
        }
    }

    #[test]
    fn appending_never_rewrites_earlier_bytes() {
        let (_d, s) = store();
        let mut w = s.writer("m-1").unwrap();
        w.append(&seg(0, "first")).unwrap();
        let before = fs::read(s.path_for("m-1")).unwrap();
        w.append(&seg(1, "second")).unwrap();
        drop(w);
        s.writer("m-1").unwrap().append(&seg(2, "third")).unwrap();
        let after = fs::read(s.path_for("m-1")).unwrap();
        assert_eq!(&after[..before.len()], before.as_slice());
    }

    #[test]
    fn invalid_ids_and_a_missing_key_are_refused() {
        let (_d, s) = store();
        assert!(matches!(s.load("../x"), Err(TranscriptError::InvalidId)));
        assert!(matches!(s.writer("a/b"), Err(TranscriptError::InvalidId)));
        assert!(matches!(
            LockedTranscriptStore.load("m-1"),
            Err(TranscriptError::KeyUnavailable)
        ));
        let foreign = s.path_for("m-9");
        fs::write(&foreign, b"not a transcript").unwrap();
        assert!(matches!(s.load("m-9"), Err(TranscriptError::Corrupt)));
    }
}
