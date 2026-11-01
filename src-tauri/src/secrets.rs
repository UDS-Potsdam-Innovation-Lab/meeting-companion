//! The Claude API key. It lives only in the OS keychain ([`KeychainSecretStore`]: entry service = the
//! app identifier, account [`API_KEY_ACCOUNT`]) and, while in use, in memory, where it is zeroed on
//! drop. It is never written to a file, logged, put into an error or sent to the UI: the UI only ever
//! learns [`ApiKeyStatus`] (`{ set: bool }`).

use std::sync::Mutex;

use serde::Serialize;
use zeroize::Zeroizing;

/// Keychain account of the Anthropic API key.
pub const API_KEY_ACCOUNT: &str = "anthropic-api-key";
/// Longest key accepted.
pub const MAX_KEY_LEN: usize = 512;

/// An API key that passed [`ApiKey::parse`]. Its `Debug` output is redacted.
#[derive(Clone, PartialEq, Eq)]
pub struct ApiKey(Zeroizing<String>);

impl ApiKey {
    /// Trims the input and accepts 1–512 printable ASCII characters without spaces.
    pub fn parse(raw: &str) -> Result<ApiKey, SecretError> {
        let key = raw.trim();
        let ok = !key.is_empty()
            && key.len() <= MAX_KEY_LEN
            && key.bytes().all(|b| b.is_ascii_graphic());
        if ok {
            Ok(ApiKey(Zeroizing::new(key.to_owned())))
        } else {
            Err(SecretError::InvalidKey)
        }
    }

    /// The key for the `x-api-key` header, and nowhere else.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for ApiKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ApiKey(<redacted>)")
    }
}

/// Why the key could not be saved, read or removed. Names no value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SecretError {
    /// Not 1–512 printable ASCII characters without spaces.
    InvalidKey,
    /// The OS keychain is locked or missing. The app keeps running; the key is kept nowhere else.
    KeychainUnavailable,
}

impl std::fmt::Display for SecretError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            SecretError::InvalidKey => "the API key is not valid",
            SecretError::KeychainUnavailable => "the system keychain is not available",
        })
    }
}

/// All the UI learns about the key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ApiKeyStatus {
    pub set: bool,
}

/// Where the API key is kept.
pub trait SecretStore: Send + Sync {
    fn get(&self) -> Result<Option<ApiKey>, SecretError>;
    /// Saves or replaces the key.
    fn set(&self, key: &ApiKey) -> Result<(), SecretError>;
    /// Removes the key; removing a missing key is not an error.
    fn delete(&self) -> Result<(), SecretError>;
}

/// The OS keychain: Secret Service on Linux, Keychain on macOS, Credential Manager on Windows.
pub struct KeychainSecretStore {
    service: String,
}

impl KeychainSecretStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    fn entry(&self) -> Result<keyring::Entry, SecretError> {
        keyring::Entry::new(&self.service, API_KEY_ACCOUNT).map_err(unavailable)
    }
}

/// Logs the kind of keychain failure (the keyring error names no secret) and maps it.
fn unavailable(e: keyring::Error) -> SecretError {
    let kind = match e {
        keyring::Error::NoStorageAccess(_) => "no storage access",
        keyring::Error::PlatformFailure(_) => "platform failure",
        keyring::Error::BadEncoding(_) => "bad encoding",
        _ => "other",
    };
    crate::log!("the system keychain is not available ({kind})");
    SecretError::KeychainUnavailable
}

impl SecretStore for KeychainSecretStore {
    fn get(&self) -> Result<Option<ApiKey>, SecretError> {
        match self.entry()?.get_password() {
            Ok(stored) => {
                let stored = Zeroizing::new(stored);
                // A key someone changed outside the app so that it no longer parses counts as none.
                Ok(ApiKey::parse(&stored).ok())
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(unavailable(e)),
        }
    }

    fn set(&self, key: &ApiKey) -> Result<(), SecretError> {
        self.entry()?
            .set_password(key.expose())
            .map_err(unavailable)
    }

    fn delete(&self) -> Result<(), SecretError> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(unavailable(e)),
        }
    }
}

/// Keeps the key in memory: tests, the smoke run and `MEETING_COMPANION_STORE=memory`.
#[derive(Default)]
pub struct MemorySecretStore {
    key: Mutex<Option<ApiKey>>,
    unavailable: bool,
    reads: Mutex<usize>,
}

impl MemorySecretStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// A keychain that refuses every request (locked or no Secret Service).
    pub fn unavailable() -> Self {
        Self {
            unavailable: true,
            ..Self::default()
        }
    }

    /// How often the key was read (tests: "Off" never touches the keychain).
    pub fn reads(&self) -> usize {
        *self.reads.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn check(&self) -> Result<(), SecretError> {
        if self.unavailable {
            Err(SecretError::KeychainUnavailable)
        } else {
            Ok(())
        }
    }
}

impl SecretStore for MemorySecretStore {
    fn get(&self) -> Result<Option<ApiKey>, SecretError> {
        *self.reads.lock().unwrap_or_else(|e| e.into_inner()) += 1;
        self.check()?;
        Ok(self.key.lock().unwrap_or_else(|e| e.into_inner()).clone())
    }

    fn set(&self, key: &ApiKey) -> Result<(), SecretError> {
        self.check()?;
        *self.key.lock().unwrap_or_else(|e| e.into_inner()) = Some(key.clone());
        Ok(())
    }

    fn delete(&self) -> Result<(), SecretError> {
        self.check()?;
        *self.key.lock().unwrap_or_else(|e| e.into_inner()) = None;
        Ok(())
    }
}

/// `set_api_key`: checks the input, then saves or replaces the key.
pub fn set_api_key(store: &dyn SecretStore, raw: &str) -> Result<ApiKeyStatus, SecretError> {
    let key = ApiKey::parse(raw).inspect_err(|e| crate::log!("API key refused: {e}"))?;
    store.set(&key)?;
    Ok(ApiKeyStatus { set: true })
}

/// `delete_api_key`: removes the keychain entry.
pub fn delete_api_key(store: &dyn SecretStore) -> Result<ApiKeyStatus, SecretError> {
    store.delete()?;
    Ok(ApiKeyStatus { set: false })
}

/// `get_api_key_status`: whether a key is saved, never the key.
pub fn api_key_status(store: &dyn SecretStore) -> Result<ApiKeyStatus, SecretError> {
    Ok(ApiKeyStatus {
        set: store.get()?.is_some(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const MARKER: &str = "FAKE-MARKER-KEY-for-tests-only-4417";

    #[test]
    fn input_is_trimmed_and_must_be_1_to_512_printable_ascii_characters() {
        assert_eq!(
            ApiKey::parse(&format!("  {MARKER}\n")).unwrap().expose(),
            MARKER
        );
        assert_eq!(ApiKey::parse(&"k".repeat(512)).unwrap().expose().len(), 512);
        for bad in [
            String::new(),
            "   ".into(),
            "k".repeat(513),
            "two words".into(),
            "line\nbreak".into(),
            "tab\there".into(),
            "umlaut-ä".into(),
            "nul\u{0}".into(),
        ] {
            assert_eq!(ApiKey::parse(&bad), Err(SecretError::InvalidKey), "{bad:?}");
        }
    }

    #[test]
    fn the_status_is_set_yes_or_no_only() {
        let store = MemorySecretStore::new();
        assert_eq!(api_key_status(&store), Ok(ApiKeyStatus { set: false }));
        set_api_key(&store, MARKER).unwrap();
        let status = api_key_status(&store).unwrap();
        assert_eq!(
            serde_json::to_value(status).unwrap(),
            serde_json::json!({ "set": true })
        );
        // Replace.
        set_api_key(&store, "FAKE-OTHER-for-tests-only").unwrap();
        assert_eq!(
            store.get().unwrap().unwrap().expose(),
            "FAKE-OTHER-for-tests-only"
        );
        // Delete removes the entry; deleting again is fine.
        assert_eq!(delete_api_key(&store), Ok(ApiKeyStatus { set: false }));
        assert_eq!(store.get(), Ok(None));
        assert_eq!(delete_api_key(&store), Ok(ApiKeyStatus { set: false }));
    }

    #[test]
    fn an_invalid_key_names_no_value_in_the_error_or_the_log() {
        let store = MemorySecretStore::new();
        crate::log::capture();
        let bad = format!("{MARKER} with spaces");
        let err = set_api_key(&store, &bad).unwrap_err();
        let lines = crate::log::take_captured();
        assert_eq!(err, SecretError::InvalidKey);
        let shown = format!("{err} {err:?} {}", serde_json::to_string(&err).unwrap());
        assert!(!shown.contains(MARKER), "{shown}");
        assert!(lines.iter().all(|l| !l.contains(MARKER)), "{lines:?}");
        assert!(lines.iter().any(|l| l.contains("API key refused")));
        assert_eq!(store.get(), Ok(None));
    }

    #[test]
    fn a_locked_keychain_gives_keychain_unavailable() {
        let store = MemorySecretStore::unavailable();
        assert_eq!(
            set_api_key(&store, MARKER),
            Err(SecretError::KeychainUnavailable)
        );
        assert_eq!(
            api_key_status(&store),
            Err(SecretError::KeychainUnavailable)
        );
        assert_eq!(
            delete_api_key(&store),
            Err(SecretError::KeychainUnavailable)
        );
        assert_eq!(
            serde_json::to_value(SecretError::KeychainUnavailable).unwrap(),
            serde_json::json!({ "kind": "keychainUnavailable" })
        );
    }

    #[test]
    fn debug_output_never_shows_the_key() {
        let key = ApiKey::parse(MARKER).unwrap();
        assert_eq!(format!("{key:?}"), "ApiKey(<redacted>)");
        assert_eq!(format!("{:?}", Some(key)), "Some(ApiKey(<redacted>))");
    }

    /// Uses the real OS keychain; run by hand with `cargo test -- --ignored keychain`.
    #[test]
    #[ignore]
    fn keychain_api_key_round_trip() {
        let store = KeychainSecretStore::new("de.udspotsdam.meetingcompanion.test");
        set_api_key(&store, "FAKE-TOKEN-for-tests-only").expect("set");
        assert_eq!(api_key_status(&store), Ok(ApiKeyStatus { set: true }));
        assert_eq!(
            store.get().unwrap().unwrap().expose(),
            "FAKE-TOKEN-for-tests-only"
        );
        delete_api_key(&store).expect("delete");
        assert_eq!(api_key_status(&store), Ok(ApiKeyStatus { set: false }));
    }
}
