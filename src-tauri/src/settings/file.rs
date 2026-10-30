use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use zeroize::Zeroizing;

use super::{Settings, SettingsStore, StoreFailure};
use crate::crypto::{self, DataKey};

/// First bytes of a settings file.
pub const MAGIC: &[u8; 8] = b"MCSETT01";
/// Associated data of the sealed record: the format and the purpose. A meeting file (bound to
/// `MCMEET01 || id`) or a transcript record (bound to its meeting and position) copied over the
/// settings file does not open.
const AAD: &[u8] = b"MCSETT01|purpose=settings";
/// The settings are a few hundred bytes; anything far larger is not ours and is not read.
const MAX_FILE_BYTES: u64 = 64 * 1024;

/// The settings as one file, `MAGIC || nonce || ciphertext + tag`, sealed with the meeting data key
/// (XChaCha20-Poly1305, see [`crate::crypto`]). A save writes a temp file and renames it over the
/// old one, so a crash leaves either the old or the new settings.
pub struct FileSettingsStore {
    path: PathBuf,
    key: DataKey,
    write_lock: Mutex<()>,
}

impl FileSettingsStore {
    pub fn new(path: impl Into<PathBuf>, key: DataKey) -> Self {
        Self {
            path: path.into(),
            key,
            write_lock: Mutex::new(()),
        }
    }

    fn temp_path(&self) -> PathBuf {
        let mut name = self
            .path
            .file_name()
            .map(|n| n.to_os_string())
            .unwrap_or_default();
        name.push(".tmp");
        self.path
            .with_file_name(format!(".{}", name.to_string_lossy()))
    }
}

/// Seals settings JSON for the settings file.
pub fn seal(key: &DataKey, json: &[u8]) -> Vec<u8> {
    let mut out = MAGIC.to_vec();
    out.extend_from_slice(&crypto::seal_with(key, AAD, json));
    out
}

/// Opens a settings file; `None` if it is not one, was changed or belongs to another key.
pub fn open(key: &DataKey, sealed: &[u8]) -> Option<Zeroizing<Vec<u8>>> {
    let rest = sealed.strip_prefix(MAGIC.as_slice())?;
    crypto::open_with(key, AAD, rest)
}

impl SettingsStore for FileSettingsStore {
    fn load(&self) -> Result<Option<Settings>, StoreFailure> {
        let mut file = match File::open(&self.path) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(StoreFailure::Io(e.kind())),
        };
        let meta = file.metadata().map_err(|e| StoreFailure::Io(e.kind()))?;
        if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
            return Err(StoreFailure::Corrupt);
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|e| StoreFailure::Io(e.kind()))?;
        let plain = open(&self.key, &bytes).ok_or(StoreFailure::Corrupt)?;
        Settings::from_stored(&plain)
            .map(Some)
            .ok_or(StoreFailure::Corrupt)
    }

    fn save(&self, settings: &Settings) -> Result<(), StoreFailure> {
        let json = Zeroizing::new(
            serde_json::to_vec(settings)
                .map_err(|_| StoreFailure::Io(std::io::ErrorKind::Other))?,
        );
        let sealed = seal(&self.key, &json);
        let _guard = self.write_lock.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|e| StoreFailure::Io(e.kind()))?;
        }
        let tmp = self.temp_path();
        let result = (|| {
            let mut f = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&tmp)?;
            f.write_all(&sealed)?;
            f.sync_all()?;
            drop(f);
            fs::rename(&tmp, &self.path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        result.map_err(|e| StoreFailure::Io(e.kind()))
    }
}
