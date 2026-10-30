//! Encryption at rest for meeting files.
//!
//! Scheme: XChaCha20-Poly1305 (RustCrypto `chacha20poly1305`) with a 256-bit data key. Every write
//! uses a fresh random 192-bit nonce from the OS random generator, so nonces never repeat in
//! practice. A sealed file is `MAGIC (8 bytes) || nonce (24 bytes) || ciphertext + tag (16 bytes)`.
//! The associated data is `MAGIC || meeting id`, which ties a file to its name: a file copied over
//! another meeting's file fails to open.
//!
//! The data key lives only in the OS keychain ([`KeychainKeyProvider`]) and in memory, where it is
//! zeroed on drop. It is never written to disk or logged; its `Debug` output is redacted.

use std::sync::Mutex;

use chacha20poly1305::aead::{Aead, AeadCore, OsRng, Payload};
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
use zeroize::Zeroizing;

pub const KEY_LEN: usize = 32;
pub const MAGIC: &[u8; 8] = b"MCMEET01";
const NONCE_LEN: usize = 24;
const TAG_LEN: usize = 16;
/// Bytes a sealed file has besides the ciphertext of the payload.
pub const OVERHEAD: usize = MAGIC.len() + NONCE_LEN + TAG_LEN;

/// The 256-bit key that encrypts meeting files.
#[derive(Clone, PartialEq, Eq)]
pub struct DataKey(Zeroizing<[u8; KEY_LEN]>);

impl DataKey {
    /// A new random key from the OS random generator.
    pub fn generate() -> Self {
        let key = XChaCha20Poly1305::generate_key(&mut OsRng);
        let mut bytes = Zeroizing::new([0u8; KEY_LEN]);
        bytes.copy_from_slice(&key);
        Self(bytes)
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        let arr: [u8; KEY_LEN] = bytes.try_into().ok()?;
        Some(Self(Zeroizing::new(arr)))
    }

    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_slice()
    }

    fn cipher(&self) -> XChaCha20Poly1305 {
        XChaCha20Poly1305::new(self.0.as_slice().into())
    }
}

impl std::fmt::Debug for DataKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DataKey(<redacted>)")
    }
}

fn aad(id: &str) -> Vec<u8> {
    let mut aad = MAGIC.to_vec();
    aad.extend_from_slice(id.as_bytes());
    aad
}

/// Encrypts `plaintext` for the meeting `id`.
pub fn seal(key: &DataKey, id: &str, plaintext: &[u8]) -> Vec<u8> {
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let aad = aad(id);
    let ciphertext = key
        .cipher()
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .expect("XChaCha20-Poly1305 encryption of an in-memory buffer cannot fail");
    let mut out = Vec::with_capacity(OVERHEAD + plaintext.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    out
}

/// Decrypts a sealed file for the meeting `id`. `None` if it is not ours, was changed, belongs to
/// another meeting or was sealed with another key.
pub fn open(key: &DataKey, id: &str, sealed: &[u8]) -> Option<Zeroizing<Vec<u8>>> {
    if sealed.len() < OVERHEAD || &sealed[..MAGIC.len()] != MAGIC {
        return None;
    }
    let (nonce, ciphertext) = sealed[MAGIC.len()..].split_at(NONCE_LEN);
    let aad = aad(id);
    key.cipher()
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: &aad,
            },
        )
        .ok()
        .map(Zeroizing::new)
}

/// Why the data key could not be read or stored. Never contains key material.
#[derive(Debug)]
pub struct KeyError(pub String);

impl std::fmt::Display for KeyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "keychain unavailable: {}", self.0)
    }
}

/// Where the data key is kept.
pub trait KeyProvider: Send + Sync {
    /// The stored key, `None` if there is none yet.
    fn load(&self) -> Result<Option<DataKey>, KeyError>;
    fn store(&self, key: &DataKey) -> Result<(), KeyError>;
}

/// The OS keychain: Secret Service on Linux, Keychain on macOS, Credential Manager on Windows.
pub struct KeychainKeyProvider {
    service: String,
    account: String,
}

impl KeychainKeyProvider {
    pub fn new(service: impl Into<String>, account: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            account: account.into(),
        }
    }

    fn entry(&self) -> Result<keyring::Entry, KeyError> {
        keyring::Entry::new(&self.service, &self.account).map_err(|e| KeyError(e.to_string()))
    }
}

impl KeyProvider for KeychainKeyProvider {
    fn load(&self) -> Result<Option<DataKey>, KeyError> {
        match self.entry()?.get_secret() {
            Ok(bytes) => {
                let bytes = Zeroizing::new(bytes);
                DataKey::from_bytes(&bytes)
                    .map(Some)
                    .ok_or_else(|| KeyError("stored key has the wrong length".into()))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(KeyError(e.to_string())),
        }
    }

    fn store(&self, key: &DataKey) -> Result<(), KeyError> {
        self.entry()?
            .set_secret(key.as_bytes())
            .map_err(|e| KeyError(e.to_string()))
    }
}

/// Keeps the key in memory. For tests only; the app uses [`KeychainKeyProvider`].
#[derive(Default)]
pub struct MemoryKeyProvider {
    key: Mutex<Option<DataKey>>,
    unavailable: bool,
}

impl MemoryKeyProvider {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_key(key: DataKey) -> Self {
        Self {
            key: Mutex::new(Some(key)),
            unavailable: false,
        }
    }

    /// A keychain that refuses every request, as when no Secret Service is running.
    pub fn unavailable() -> Self {
        Self {
            key: Mutex::new(None),
            unavailable: true,
        }
    }

    pub fn current(&self) -> Option<DataKey> {
        self.key.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

impl KeyProvider for MemoryKeyProvider {
    fn load(&self) -> Result<Option<DataKey>, KeyError> {
        if self.unavailable {
            return Err(KeyError("test keychain is unavailable".into()));
        }
        Ok(self.current())
    }

    fn store(&self, key: &DataKey) -> Result<(), KeyError> {
        if self.unavailable {
            return Err(KeyError("test keychain is unavailable".into()));
        }
        *self.key.lock().unwrap_or_else(|e| e.into_inner()) = Some(key.clone());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let key = DataKey::generate();
        let sealed = seal(&key, "m-1", b"{\"title\":\"Budget\"}");
        assert_eq!(sealed.len(), OVERHEAD + 18);
        assert_eq!(
            open(&key, "m-1", &sealed).unwrap().as_slice(),
            b"{\"title\":\"Budget\"}"
        );
    }

    #[test]
    fn same_plaintext_gives_different_ciphertext() {
        let key = DataKey::generate();
        assert_ne!(seal(&key, "m-1", b"same"), seal(&key, "m-1", b"same"));
    }

    #[test]
    fn tampered_ciphertext_nonce_or_header_is_rejected() {
        let key = DataKey::generate();
        let sealed = seal(&key, "m-1", b"hello world");
        for i in [0, MAGIC.len(), MAGIC.len() + NONCE_LEN, sealed.len() - 1] {
            let mut bad = sealed.clone();
            bad[i] ^= 0x01;
            assert!(
                open(&key, "m-1", &bad).is_none(),
                "flip at {i} not detected"
            );
        }
        assert!(open(&key, "m-1", &sealed[..sealed.len() - 1]).is_none());
        assert!(open(&key, "m-1", b"").is_none());
    }

    #[test]
    fn wrong_key_or_other_meeting_id_is_rejected() {
        let key = DataKey::generate();
        let sealed = seal(&key, "m-1", b"hello");
        assert!(open(&DataKey::generate(), "m-1", &sealed).is_none());
        assert!(open(&key, "m-2", &sealed).is_none());
    }

    #[test]
    fn debug_output_never_shows_the_key() {
        let key = DataKey::from_bytes(&[0xAB; KEY_LEN]).unwrap();
        let shown = format!("{key:?}");
        assert_eq!(shown, "DataKey(<redacted>)");
        assert!(DataKey::from_bytes(&[0; 31]).is_none());
    }

    /// Uses the real OS keychain; run by hand with `cargo test -- --ignored keychain`.
    #[test]
    #[ignore]
    fn keychain_round_trip() {
        let provider =
            KeychainKeyProvider::new("de.udspotsdam.meetingcompanion.test", "keychain-round-trip");
        let key = DataKey::generate();
        provider.store(&key).expect("store");
        assert_eq!(provider.load().expect("load"), Some(key));
        provider
            .entry()
            .unwrap()
            .delete_credential()
            .expect("cleanup");
        assert_eq!(provider.load().expect("load after delete"), None);
    }
}
