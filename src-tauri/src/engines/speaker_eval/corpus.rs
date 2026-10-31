//! The speaker corpus under `src-tauri/testdata/speakers/`: single-speaker clips, `manifest.json`
//! (source, speaker, utterance, licence and SHA-256 of every clip) and `ATTRIBUTION.md`. [`verify`]
//! checks that the folder holds exactly the listed clips, unaltered, under an allowed licence, and stays
//! small. Test-only; nothing here is part of the app.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde::Deserialize;

use super::{sha256, wav};

/// Marks the corpus files; the release build must not contain it (checked in CI).
pub const CORPUS_MARKER: &str = "meeting-companion-speaker-corpus-v1";
/// Licences a clip may carry.
pub const LICENCES: [&str; 3] = ["CC0-1.0", "CC-BY-4.0", "public-domain"];
/// The whole corpus folder stays below this many bytes (15 MB).
pub const MAX_CORPUS_BYTES: u64 = 15_000_000;
/// File endings counted as audio: every such file must be in the manifest.
const AUDIO_EXTENSIONS: [&str; 9] = [
    "wav", "flac", "mp3", "ogg", "opus", "m4a", "aac", "webm", "aiff",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    /// Path relative to the corpus folder, with `/`.
    pub file: String,
    /// Corpus speaker id, e.g. `de-f1`.
    pub speaker: String,
    pub lang: String,
    pub source: String,
    /// The source's id of the utterance.
    pub utterance: String,
    pub text: String,
    pub licence: String,
    pub duration_ms: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    pub marker: String,
    pub clips: Vec<Clip>,
}

/// The committed corpus folder.
pub fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("testdata/speakers")
}

pub fn load_manifest(root: &Path) -> Result<Manifest, String> {
    let text = std::fs::read_to_string(root.join("manifest.json"))
        .map_err(|e| format!("manifest.json: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("manifest.json: {e}"))
}

/// Files below `dir`, as paths relative to `root` with `/`, with their sizes.
fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, u64>) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let meta = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if meta.is_dir() {
            walk(root, &path, out)?;
        } else {
            let rel = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/");
            out.insert(rel, meta.len());
        }
    }
    Ok(())
}

fn is_audio(rel: &str) -> bool {
    Path::new(rel)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| AUDIO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Every problem with the corpus in `root`; empty when it is licence-clean and unaltered.
pub fn verify(root: &Path) -> Vec<String> {
    let mut problems = Vec::new();
    let manifest = match load_manifest(root) {
        Ok(m) => m,
        Err(e) => return vec![e],
    };
    if manifest.marker != CORPUS_MARKER {
        problems.push(format!("manifest.json: marker is not {CORPUS_MARKER}"));
    }
    let mut files = BTreeMap::new();
    if let Err(e) = walk(root, root, &mut files) {
        return vec![e];
    }
    let attribution = std::fs::read_to_string(root.join("ATTRIBUTION.md")).unwrap_or_default();
    if !files.contains_key("ATTRIBUTION.md") {
        problems.push("ATTRIBUTION.md is missing".into());
    }
    let mut listed = BTreeSet::new();
    let mut ids = BTreeSet::new();
    for clip in &manifest.clips {
        let at = format!("{} ({})", clip.id, clip.file);
        if !ids.insert(clip.id.as_str()) {
            problems.push(format!("{at}: id listed twice"));
        }
        if clip
            .file
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
        {
            problems.push(format!("{at}: not a plain relative path"));
            continue;
        }
        listed.insert(clip.file.clone());
        for (field, value) in [
            ("source", &clip.source),
            ("utterance", &clip.utterance),
            ("text", &clip.text),
        ] {
            if value.trim().is_empty() {
                problems.push(format!("{at}: no {field}"));
            }
        }
        if !LICENCES.contains(&clip.licence.as_str()) {
            problems.push(format!(
                "{at}: licence {} is not one of {LICENCES:?}",
                clip.licence
            ));
        }
        if clip.licence == "CC-BY-4.0" && !attribution.lines().any(|l| l.contains(&clip.id)) {
            problems.push(format!("{at}: CC-BY-4.0 without a line in ATTRIBUTION.md"));
        }
        let Ok(bytes) = std::fs::read(root.join(&clip.file)) else {
            problems.push(format!("{at}: listed in the manifest but missing"));
            continue;
        };
        let actual = sha256::hex(&bytes);
        if actual != clip.sha256 {
            problems.push(format!(
                "{at}: SHA-256 {actual} does not match the manifest"
            ));
        }
        match wav::samples(&bytes) {
            Ok(s) if (s.len() as u64 * 1000 / 16_000).abs_diff(clip.duration_ms) > 1 => {
                problems.push(format!("{at}: duration differs from the manifest"));
            }
            Ok(_) => {}
            Err(e) => problems.push(format!("{at}: {e}")),
        }
    }
    for rel in files.keys().filter(|r| is_audio(r)) {
        if !listed.contains(rel) {
            problems.push(format!("{rel}: audio file not listed in the manifest"));
        }
    }
    let total: u64 = files.values().sum();
    if total >= MAX_CORPUS_BYTES {
        problems.push(format!(
            "the corpus holds {total} bytes, more than {MAX_CORPUS_BYTES}"
        ));
    }
    problems
}

/// The samples of every clip in the committed corpus, by id.
pub fn load_clips(root: &Path, manifest: &Manifest) -> BTreeMap<String, Vec<f32>> {
    manifest
        .clips
        .iter()
        .map(|c| {
            let bytes = std::fs::read(root.join(&c.file)).expect("clip readable");
            let samples = wav::samples(&bytes).unwrap_or_else(|e| panic!("{}: {e}", c.file));
            (c.id.clone(), samples)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// AC1: the committed corpus is complete, unaltered, licence-clean and small.
    #[test]
    fn the_committed_corpus_is_licence_clean_and_verifiable() {
        let root = root();
        let problems = verify(&root);
        assert!(problems.is_empty(), "{problems:#?}");
        let manifest = load_manifest(&root).unwrap();
        assert!(manifest.clips.len() >= 10);
        let langs: BTreeSet<&str> = manifest.clips.iter().map(|c| c.lang.as_str()).collect();
        assert_eq!(langs, BTreeSet::from(["de", "en"]));
    }

    /// A tiny corpus in a temp folder: two clips (CC0 and CC-BY with attribution).
    fn fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("clips")).unwrap();
        let mut clips = Vec::new();
        for (i, (id, licence)) in [("x-1", "CC0-1.0"), ("y-1", "CC-BY-4.0")]
            .into_iter()
            .enumerate()
        {
            let pcm: Vec<i16> = (0..1_600).map(|n| ((n * (i + 3)) % 200) as i16).collect();
            let bytes = wav::encode(&pcm);
            let file = format!("clips/{id}.wav");
            std::fs::write(dir.path().join(&file), &bytes).unwrap();
            clips.push(serde_json::json!({
                "id": id, "file": file, "speaker": id, "lang": "en", "source": "test fixture",
                "utterance": "u", "text": "t", "licence": licence, "durationMs": 100,
                "sha256": sha256::hex(&bytes),
            }));
        }
        let manifest = serde_json::json!({ "marker": CORPUS_MARKER, "clips": clips });
        std::fs::write(
            dir.path().join("manifest.json"),
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();
        std::fs::write(
            dir.path().join("ATTRIBUTION.md"),
            "# Attribution\n\n- y-1: Test Speaker, CC-BY-4.0\n",
        )
        .unwrap();
        dir
    }

    fn edit_manifest(dir: &Path, f: impl FnOnce(&mut serde_json::Value)) {
        let path = dir.join("manifest.json");
        let mut m: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        f(&mut m);
        std::fs::write(&path, serde_json::to_string(&m).unwrap()).unwrap();
    }

    fn fails_with(dir: &Path, needle: &str) {
        let problems = verify(dir);
        assert!(
            problems.iter().any(|p| p.contains(needle)),
            "expected {needle:?} in {problems:#?}"
        );
    }

    /// AC1: an unlisted, altered, missing or wrongly licensed file fails the check.
    #[test]
    fn unlisted_altered_missing_or_wrongly_licensed_files_fail() {
        let ok = fixture();
        assert!(verify(ok.path()).is_empty(), "{:#?}", verify(ok.path()));

        let d = fixture();
        std::fs::create_dir(d.path().join("extra")).unwrap();
        std::fs::write(d.path().join("extra/stray.WAV"), wav::encode(&[1, 2])).unwrap();
        fails_with(d.path(), "extra/stray.WAV: audio file not listed");

        let d = fixture();
        let path = d.path().join("clips/x-1.wav");
        let mut bytes = std::fs::read(&path).unwrap();
        bytes[100] ^= 1;
        std::fs::write(&path, bytes).unwrap();
        fails_with(d.path(), "x-1 (clips/x-1.wav): SHA-256");

        let d = fixture();
        std::fs::remove_file(d.path().join("clips/y-1.wav")).unwrap();
        fails_with(
            d.path(),
            "y-1 (clips/y-1.wav): listed in the manifest but missing",
        );

        let d = fixture();
        edit_manifest(d.path(), |m| {
            m["clips"][0]["licence"] = "CC-BY-NC-4.0".into()
        });
        fails_with(d.path(), "licence CC-BY-NC-4.0 is not one of");

        let d = fixture();
        std::fs::write(d.path().join("ATTRIBUTION.md"), "# Attribution\n").unwrap();
        fails_with(d.path(), "y-1 (clips/y-1.wav): CC-BY-4.0 without a line");

        let d = fixture();
        edit_manifest(d.path(), |m| m["clips"][1]["source"] = " ".into());
        fails_with(d.path(), "y-1 (clips/y-1.wav): no source");

        let d = fixture();
        edit_manifest(d.path(), |m| m["clips"][1]["file"] = "../y-1.wav".into());
        fails_with(d.path(), "not a plain relative path");

        let d = fixture();
        // A sparse file: its length counts, without writing 15 MB.
        std::fs::File::create(d.path().join("notes.bin"))
            .unwrap()
            .set_len(MAX_CORPUS_BYTES)
            .unwrap();
        fails_with(d.path(), "more than 15000000");
    }
}
