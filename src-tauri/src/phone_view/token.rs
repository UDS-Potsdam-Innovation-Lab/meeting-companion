//! The phone view's access token: one per opening, 256 bits from the OS random generator,
//! base64url-encoded. It lives in memory only, is never logged or printed (`Debug` is redacted), and is
//! zeroed when the view closes.

use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::aead::OsRng;
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

/// Random bytes per token (256 bits; the spec asks for at least 128).
pub const TOKEN_BYTES: usize = 32;
/// Length of the base64url text of [`TOKEN_BYTES`] without padding.
pub const TOKEN_CHARS: usize = (TOKEN_BYTES * 4).div_ceil(3);

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

pub struct PhoneViewToken(Zeroizing<String>);

impl PhoneViewToken {
    /// A new token from the OS random generator.
    pub fn new() -> Self {
        let mut bytes = Zeroizing::new([0u8; TOKEN_BYTES]);
        OsRng.fill_bytes(bytes.as_mut());
        Self(Zeroizing::new(base64url(bytes.as_ref())))
    }

    /// The token text for the URL fragment. Never log it.
    pub fn expose(&self) -> &str {
        &self.0
    }

    /// Whether `presented` is this token. The bytes are compared in constant time; only the length
    /// (which is public) can end the comparison early.
    pub fn matches(&self, presented: &str) -> bool {
        bool::from(self.0.as_bytes().ct_eq(presented.as_bytes()))
    }

    /// Whether `s` has the shape of a token (length and alphabet); says nothing about its validity.
    pub fn is_well_formed(s: &str) -> bool {
        s.len() == TOKEN_CHARS && s.bytes().all(|b| ALPHABET.contains(&b))
    }
}

impl Default for PhoneViewToken {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for PhoneViewToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PhoneViewToken(<redacted>)")
    }
}

/// base64url without padding (RFC 4648 §5).
pub fn base64url(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        let chars = chunk.len() + 1;
        for i in 0..chars {
            out.push(ALPHABET[((n >> (18 - 6 * i)) & 0x3f) as usize] as char);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_matches_the_rfc_4648_test_vectors_without_padding() {
        for (input, expected) in [
            ("", ""),
            ("f", "Zg"),
            ("fo", "Zm8"),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg"),
            ("fooba", "Zm9vYmE"),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(base64url(input.as_bytes()), expected);
        }
        // The url-safe characters instead of + and /.
        assert_eq!(base64url(&[0xfb, 0xff, 0xbf]), "-_-_");
    }

    #[test]
    fn a_token_has_256_random_bits_in_base64url_and_is_new_every_time() {
        const { assert!(TOKEN_BYTES * 8 >= 128) };
        let tokens: Vec<_> = (0..64).map(|_| PhoneViewToken::new()).collect();
        for t in &tokens {
            assert_eq!(t.expose().len(), TOKEN_CHARS);
            assert_eq!(TOKEN_CHARS, 43);
            assert!(PhoneViewToken::is_well_formed(t.expose()));
            assert!(!t.expose().contains(['+', '/', '=']));
        }
        let mut texts: Vec<_> = tokens.iter().map(|t| t.expose().to_owned()).collect();
        texts.sort();
        texts.dedup();
        assert_eq!(texts.len(), tokens.len());
    }

    #[test]
    fn matches_only_the_exact_token() {
        let t = PhoneViewToken::new();
        assert!(t.matches(t.expose()));
        let mut other = t.expose().to_owned();
        let last = other.pop().unwrap();
        other.push(if last == 'A' { 'B' } else { 'A' });
        assert!(!t.matches(&other));
        assert!(!t.matches(""));
        assert!(!t.matches(&t.expose()[..42]));
        assert!(!t.matches(&format!("{} ", t.expose())));
        assert!(!PhoneViewToken::is_well_formed("FAKE-TOKEN-for-tests-only"));
        assert!(!PhoneViewToken::is_well_formed(&"a".repeat(42)));
        assert!(!PhoneViewToken::is_well_formed(&format!(
            "{}=",
            "a".repeat(42)
        )));
    }

    #[test]
    fn debug_never_shows_the_token() {
        let t = PhoneViewToken::new();
        let shown = format!("{t:?}");
        assert!(!shown.contains(t.expose()));
        assert_eq!(shown, "PhoneViewToken(<redacted>)");
    }
}
