//! The organisation's details for the imprint and controller block of "Help & legal".
//!
//! IT may deploy a plain JSON file `<app_data>/organisation.json`. It is untrusted input: the core
//! reads at most [`MAX_FILE_BYTES`], accepts only a JSON object with the closed set of keys below,
//! each an optional string of at most [`MAX_FIELD_CHARS`] characters, and hands the UI either the
//! checked fields or the kind of failure. Neither the answer nor the log ever carries the raw file
//! content (not even the name of an unknown key).

use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Map, Value};

use crate::log;

/// File name inside the app data folder.
pub const FILE_NAME: &str = "organisation.json";
/// A filled-in file is well under 2 KB; anything larger than 16 KB is not read.
pub const MAX_FILE_BYTES: u64 = 16 * 1024;
/// Longest accepted field, in characters (Unicode scalar values).
pub const MAX_FIELD_CHARS: usize = 1_000;
/// The closed schema: every key the file may have.
pub const FIELDS: [&str; 6] = [
    "name",
    "address",
    "controller",
    "dpoContact",
    "contact",
    "imprintUrl",
];

/// The checked details. Every field is optional; empty strings count as absent.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Organisation {
    pub name: Option<String>,
    pub address: Option<String>,
    pub controller: Option<String>,
    pub dpo_contact: Option<String>,
    pub contact: Option<String>,
    pub imprint_url: Option<String>,
}

/// Why the file was not used. Only this kind is logged or sent to the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Rejection {
    /// Larger than [`MAX_FILE_BYTES`].
    TooLarge,
    /// Not a regular file (a folder, a device, a pipe).
    NotAFile,
    /// The OS refused the read.
    Unreadable,
    /// Not UTF-8 JSON, or JSON that is not one object.
    NotJson,
    /// A key outside [`FIELDS`].
    UnknownKey,
    /// A value that is not a string (numbers, `null`, objects, lists).
    NotString,
    /// A field longer than [`MAX_FIELD_CHARS`].
    TooLong,
    /// A control character other than line break or tab.
    ControlCharacter,
}

impl Rejection {
    fn as_str(self) -> &'static str {
        match self {
            Rejection::TooLarge => "too large",
            Rejection::NotAFile => "not a regular file",
            Rejection::Unreadable => "unreadable",
            Rejection::NotJson => "not a JSON object",
            Rejection::UnknownKey => "unknown key",
            Rejection::NotString => "value is not a string",
            Rejection::TooLong => "field too long",
            Rejection::ControlCharacter => "control character in a field",
        }
    }
}

/// What `load_organisation` returns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganisationLoad {
    /// `found`, `missing` (no file: the placeholder) or `invalid` (placeholder plus a notice).
    pub status: Status,
    /// Only with `found`.
    pub organisation: Option<Organisation>,
    /// Only with `invalid`.
    pub rejection: Option<Rejection>,
    /// Where IT places the file, shown read-only.
    pub path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Found,
    Missing,
    Invalid,
}

/// Checks the bytes of an `organisation.json`.
pub fn parse(bytes: &[u8]) -> Result<Organisation, Rejection> {
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(Rejection::TooLarge);
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|_| Rejection::NotJson)?;
    let Value::Object(map) = value else {
        return Err(Rejection::NotJson);
    };
    from_map(map)
}

fn from_map(map: Map<String, Value>) -> Result<Organisation, Rejection> {
    if map.keys().any(|k| !FIELDS.contains(&k.as_str())) {
        return Err(Rejection::UnknownKey);
    }
    let field = |key: &str| -> Result<Option<String>, Rejection> {
        match map.get(key) {
            None => Ok(None),
            Some(Value::String(s)) => {
                if s.chars().count() > MAX_FIELD_CHARS {
                    return Err(Rejection::TooLong);
                }
                if s.chars().any(|c| c.is_control() && c != '\n' && c != '\t') {
                    return Err(Rejection::ControlCharacter);
                }
                let trimmed = s.trim();
                Ok((!trimmed.is_empty()).then(|| trimmed.to_owned()))
            }
            Some(_) => Err(Rejection::NotString),
        }
    };
    Ok(Organisation {
        name: field("name")?,
        address: field("address")?,
        controller: field("controller")?,
        dpo_contact: field("dpoContact")?,
        contact: field("contact")?,
        imprint_url: field("imprintUrl")?,
    })
}

/// Reads at most `MAX_FILE_BYTES + 1` bytes of a regular file. `Ok(None)` if there is no file.
fn read_bounded(path: &Path) -> Result<Option<Vec<u8>>, Rejection> {
    // Checked before opening: opening a named pipe would block.
    match fs::metadata(path) {
        Ok(meta) if !meta.is_file() => return Err(Rejection::NotAFile),
        Ok(meta) if meta.len() > MAX_FILE_BYTES => return Err(Rejection::TooLarge),
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(Rejection::Unreadable),
    }
    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(Rejection::Unreadable),
    };
    // The file may grow between the check and the read; never read more than the limit allows.
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Rejection::Unreadable)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(Rejection::TooLarge);
    }
    Ok(Some(bytes))
}

/// Reads and checks the organisation file at `path`. Never fails: a missing file gives `missing`,
/// a rejected one `invalid`, and only the kind of rejection is logged.
pub fn load(path: &Path) -> OrganisationLoad {
    let shown = path.to_string_lossy().into_owned();
    let result = read_bounded(path).and_then(|bytes| bytes.map(|b| parse(&b)).transpose());
    match result {
        Ok(Some(organisation)) => OrganisationLoad {
            status: Status::Found,
            organisation: Some(organisation),
            rejection: None,
            path: shown,
        },
        Ok(None) => OrganisationLoad {
            status: Status::Missing,
            organisation: None,
            rejection: None,
            path: shown,
        },
        Err(rejection) => {
            log!("{FILE_NAME} was not used: {}", rejection.as_str());
            OrganisationLoad {
                status: Status::Invalid,
                organisation: None,
                rejection: Some(rejection),
                path: shown,
            }
        }
    }
}

/// `<app_data>/organisation.json`.
pub fn path_in(app_data: &Path) -> PathBuf {
    app_data.join(FILE_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn write(dir: &tempfile::TempDir, bytes: &[u8]) -> PathBuf {
        let path = path_in(dir.path());
        fs::write(&path, bytes).unwrap();
        path
    }

    fn full() -> Value {
        json!({
            "name": "Grundschule am Lindenpark",
            "address": "Lindenstraße 12\n14467 Potsdam",
            "controller": "Dr. Sabine Hartmann, Schulleitung",
            "dpoContact": "datenschutz@schulamt-potsdam.example",
            "contact": "sekretariat@lindenpark-schule.example",
            "imprintUrl": "lindenpark-schule.example/impressum"
        })
    }

    #[test]
    fn a_valid_file_gives_every_field() {
        let dir = tempfile::tempdir().unwrap();
        let path = write(&dir, full().to_string().as_bytes());
        let load = load(&path);
        assert_eq!(load.status, Status::Found);
        assert_eq!(load.rejection, None);
        let org = load.organisation.unwrap();
        assert_eq!(org.name.as_deref(), Some("Grundschule am Lindenpark"));
        assert_eq!(
            org.address.as_deref(),
            Some("Lindenstraße 12\n14467 Potsdam")
        );
        assert_eq!(
            org.controller.as_deref(),
            Some("Dr. Sabine Hartmann, Schulleitung")
        );
        assert_eq!(
            org.dpo_contact.as_deref(),
            Some("datenschutz@schulamt-potsdam.example")
        );
        assert_eq!(
            org.contact.as_deref(),
            Some("sekretariat@lindenpark-schule.example")
        );
        assert_eq!(
            org.imprint_url.as_deref(),
            Some("lindenpark-schule.example/impressum")
        );
        assert_eq!(load.path, path.to_string_lossy());
    }

    #[test]
    fn every_field_is_optional_and_blank_ones_count_as_absent() {
        assert_eq!(parse(b"{}"), Ok(Organisation::default()));
        let org = parse(br#"{ "name": "  Schule  ", "contact": "   " }"#).unwrap();
        assert_eq!(org.name.as_deref(), Some("Schule"));
        assert_eq!(org.contact, None);
    }

    #[test]
    fn no_file_gives_the_placeholder() {
        let dir = tempfile::tempdir().unwrap();
        let load = load(&path_in(dir.path()));
        assert_eq!(load.status, Status::Missing);
        assert_eq!(load.organisation, None);
        assert_eq!(load.rejection, None);
    }

    #[test]
    fn a_file_larger_than_16_kb_is_rejected_unread() {
        let dir = tempfile::tempdir().unwrap();
        let big = format!(r#"{{"name":"{}"}}"#, "a".repeat(MAX_FILE_BYTES as usize));
        let path = write(&dir, big.as_bytes());
        let load = load(&path);
        assert_eq!(load.status, Status::Invalid);
        assert_eq!(load.rejection, Some(Rejection::TooLarge));
        assert_eq!(parse(big.as_bytes()), Err(Rejection::TooLarge));
        // Exactly at the limit is still read.
        let pad = MAX_FILE_BYTES as usize - r#"{"name":"x"}"#.len();
        let at_limit = format!(r#"{{"name":"x"}}{}"#, " ".repeat(pad));
        assert_eq!(at_limit.len() as u64, MAX_FILE_BYTES);
        assert!(parse(at_limit.as_bytes()).is_ok());
    }

    #[test]
    fn invalid_json_and_json_that_is_not_one_object_are_rejected() {
        for bad in [
            &b"{ name: 'Schule' }"[..],
            b"{\"name\": \"Schule\"",
            b"",
            b"\xff\xfe{}",
            b"[]",
            b"[\"Schule\"]",
            b"\"Schule\"",
            b"null",
            b"42",
        ] {
            assert_eq!(parse(bad), Err(Rejection::NotJson), "{bad:?}");
        }
    }

    #[test]
    fn unknown_keys_are_rejected() {
        assert_eq!(
            parse(br#"{ "name": "Schule", "logo": "x.png" }"#),
            Err(Rejection::UnknownKey)
        );
        assert_eq!(
            parse(br#"{ "Name": "Schule" }"#),
            Err(Rejection::UnknownKey)
        );
        assert_eq!(parse(br#"{ "__proto__": {} }"#), Err(Rejection::UnknownKey));
    }

    #[test]
    fn non_string_values_are_rejected() {
        for value in [
            json!(12),
            json!(true),
            json!(null),
            json!(["a"]),
            json!({ "a": "b" }),
        ] {
            let file = json!({ "name": "Schule", "contact": value }).to_string();
            assert_eq!(parse(file.as_bytes()), Err(Rejection::NotString), "{value}");
        }
    }

    #[test]
    fn a_field_over_1000_characters_is_rejected_by_characters_not_bytes() {
        let file = json!({ "address": "a".repeat(MAX_FIELD_CHARS + 1) }).to_string();
        assert_eq!(parse(file.as_bytes()), Err(Rejection::TooLong));
        // 1,000 two-byte characters are fine.
        let file = json!({ "address": "ä".repeat(MAX_FIELD_CHARS) }).to_string();
        assert!(parse(file.as_bytes()).is_ok());
    }

    #[test]
    fn control_characters_other_than_line_breaks_and_tabs_are_rejected() {
        let file = json!({ "name": "Schule\u{202e}" }).to_string();
        // A bidi override is a format character, not a control character: it is text, shown as text.
        assert!(parse(file.as_bytes()).is_ok());
        let file = json!({ "name": "Schule\u{1b}[31m" }).to_string();
        assert_eq!(parse(file.as_bytes()), Err(Rejection::ControlCharacter));
    }

    #[test]
    fn a_folder_in_place_of_the_file_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(path_in(dir.path())).unwrap();
        assert_eq!(
            load(&path_in(dir.path())).rejection,
            Some(Rejection::NotAFile)
        );
    }

    #[test]
    fn markup_is_kept_as_plain_text() {
        let file = json!({
            "name": "<img src=x onerror=alert(1)>",
            "imprintUrl": "javascript:alert(1)"
        })
        .to_string();
        let org = parse(file.as_bytes()).unwrap();
        assert_eq!(org.name.as_deref(), Some("<img src=x onerror=alert(1)>"));
        assert_eq!(org.imprint_url.as_deref(), Some("javascript:alert(1)"));
    }

    #[test]
    fn a_rejected_file_never_reaches_the_log_or_the_answer() {
        const SECRET: &str = "FAKE-CONTENT-never-logged";
        let dir = tempfile::tempdir().unwrap();
        let cases: Vec<(Vec<u8>, Rejection)> = vec![
            (
                format!(r#"{{"{SECRET}": "x"}}"#).into_bytes(),
                Rejection::UnknownKey,
            ),
            (
                format!(r#"{{"name": "{SECRET}", "contact": 1}}"#).into_bytes(),
                Rejection::NotString,
            ),
            (
                format!(r#"{{"name": "{SECRET}""#).into_bytes(),
                Rejection::NotJson,
            ),
            (
                json!({ "name": format!("{SECRET}{}", "a".repeat(MAX_FIELD_CHARS)) })
                    .to_string()
                    .into_bytes(),
                Rejection::TooLong,
            ),
            (
                format!(r#"{{"name":"{SECRET}{}"}}"#, "a".repeat(20_000)).into_bytes(),
                Rejection::TooLarge,
            ),
        ];
        for (bytes, expected) in cases {
            let path = write(&dir, &bytes);
            log::capture();
            let load = load(&path);
            let lines = log::take_captured();
            assert_eq!(load.rejection, Some(expected));
            assert_eq!(load.organisation, None);
            let answer = serde_json::to_string(&load).unwrap();
            assert!(!answer.contains(SECRET), "{answer}");
            // Other tests may log at the same time; this load logged its kind only.
            let ours = format!("organisation.json was not used: {}", expected.as_str());
            assert!(lines.iter().any(|l| l.ends_with(&ours)), "{lines:?}");
            assert!(lines.iter().all(|l| !l.contains(SECRET)), "{lines:?}");
        }
    }

    #[test]
    fn the_answer_has_the_shape_the_ui_reads() {
        let load = OrganisationLoad {
            status: Status::Invalid,
            organisation: None,
            rejection: Some(Rejection::UnknownKey),
            path: "/x/organisation.json".into(),
        };
        assert_eq!(
            serde_json::to_value(&load).unwrap(),
            json!({
                "status": "invalid",
                "organisation": null,
                "rejection": "unknownKey",
                "path": "/x/organisation.json"
            })
        );
        let org = parse(br#"{ "dpoContact": "d", "imprintUrl": "i" }"#).unwrap();
        assert_eq!(
            serde_json::to_value(&org).unwrap(),
            json!({
                "name": null, "address": null, "controller": null,
                "dpoContact": "d", "contact": null, "imprintUrl": "i"
            })
        );
    }
}
