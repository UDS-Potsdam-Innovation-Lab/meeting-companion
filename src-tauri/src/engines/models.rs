//! Finds the models already on this device: whisper.cpp speech models and sherpa-onnx speaker-embedding
//! models ([`ModelKind`]).
//!
//! The app downloads nothing. It looks, read-only, in the folders listed in [`locations_for`] (the one
//! place that names them), takes a file as a model only if its header is a whisper model in the ggml
//! format that whisper.cpp loads, and refers to it by path. Found files are never copied, moved or
//! changed. Symbolic links are followed only when their target stays inside the scanned folder (the
//! Hugging Face cache links snapshots to blobs in the same folder); linked folders are not entered.
//!
//! GGUF files are not offered: the whisper.cpp version bundled with `whisper-rs` loads only the ggml
//! format (`GGML_FILE_MAGIC`), so a GGUF file would be listed but could never be loaded.
//!
//! Speaker models ([`scan_speaker`]) are single-file ONNX models in sherpa-onnx's format. The check reads
//! only the top level of the ONNX `ModelProto` (seeking past the graph) and accepts a file whose
//! `metadata_props` say `framework` = `3d-speaker` | `wespeaker` | `nemo`, `sample_rate` = `16000` and
//! give an `output_dim` — the keys sherpa-onnx v2.0.1 reads in `speaker-embedding-extractor-model.cc` and
//! `speaker-embedding-extractor-nemo-model.cc`. Any other ONNX model (VAD, ASR, TTS, …), a truncated
//! file, or a checkpoint in another format is not listed.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// Where a model was found. The UI shows a translated name for each.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ModelSource {
    /// `<app_data>/models/`, the app's own folder.
    App,
    Voxtype,
    WhisperCpp,
    Pywhispercpp,
    Buzz,
    MacWhisper,
    HuggingFace,
    /// The fake engine of tests and the smoke run.
    Test,
}

/// What a model is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelKind {
    /// Speech-to-text (whisper.cpp ggml).
    Whisper,
    /// Speaker embeddings (sherpa-onnx ONNX).
    Speaker,
}

impl ModelSource {
    /// Whether this kind of location can hold models of `kind`. Speaker models are looked for in the
    /// app's own folder and the Hugging Face cache only; the other tools keep whisper models.
    pub fn holds(self, kind: ModelKind) -> bool {
        match kind {
            ModelKind::Whisper => true,
            ModelKind::Speaker => matches!(
                self,
                ModelSource::App | ModelSource::HuggingFace | ModelSource::Test
            ),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelLocation {
    pub source: ModelSource,
    pub path: PathBuf,
}

/// A usable model file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechModel {
    /// Stable id: the canonical path. The core accepts only ids from its own scan.
    pub id: String,
    /// File name, e.g. `ggml-base.bin`.
    pub name: String,
    pub size_bytes: u64,
    pub source: ModelSource,
    /// False for English-only models (`*.en`), which cannot transcribe German.
    pub multilingual: bool,
    /// Folder the file is in, shown so a person can find it.
    pub folder: String,
}

/// The models found and every folder that was searched (shown when none was found).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelList {
    /// Preferred first: multilingual before English-only, then smaller (faster) before larger.
    pub models: Vec<SpeechModel>,
    pub searched: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Linux,
    MacOs,
    Windows,
}

impl Os {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            Os::MacOs
        } else if cfg!(windows) {
            Os::Windows
        } else {
            Os::Linux
        }
    }
}

/// What the location list depends on, so tests can use temp folders.
#[derive(Debug, Clone, Default)]
pub struct Env {
    pub app_data: PathBuf,
    pub home: Option<PathBuf>,
    /// Environment variables that move the folders (`XDG_DATA_HOME`, `HF_HOME`, …).
    pub vars: Vec<(String, String)>,
}

impl Env {
    /// The real environment of this process.
    pub fn from_process(app_data: PathBuf) -> Self {
        const VARS: [&str; 6] = [
            "XDG_DATA_HOME",
            "XDG_CACHE_HOME",
            "HF_HOME",
            "HF_HUB_CACHE",
            "LOCALAPPDATA",
            "USERPROFILE",
        ];
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from);
        Self {
            app_data,
            home,
            vars: VARS
                .iter()
                .filter_map(|k| {
                    std::env::var(k)
                        .ok()
                        .filter(|v| !v.is_empty())
                        .map(|v| ((*k).to_owned(), v))
                })
                .collect(),
        }
    }

    fn var(&self, name: &str) -> Option<PathBuf> {
        self.vars
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| PathBuf::from(v))
    }
}

/// The folders searched for models of `kind`: [`locations_for`], filtered by [`ModelSource::holds`].
pub fn locations_of(kind: ModelKind, os: Os, env: &Env) -> Vec<ModelLocation> {
    locations_for(os, env)
        .into_iter()
        .filter(|l| l.source.holds(kind))
        .collect()
}

/// Every folder the app searches for models, per OS. The only list of model locations in the app.
pub fn locations_for(os: Os, env: &Env) -> Vec<ModelLocation> {
    use ModelSource::*;
    let mut out = vec![ModelLocation {
        source: App,
        path: env.app_data.join("models"),
    }];
    let Some(home) = env.home.clone() else {
        return out;
    };
    let mut add = |source, path: PathBuf| out.push(ModelLocation { source, path });
    // Hugging Face hub cache: same layout on every OS; HF_HUB_CACHE, then HF_HOME/hub.
    let hf = env
        .var("HF_HUB_CACHE")
        .or_else(|| env.var("HF_HOME").map(|h| h.join("hub")));
    match os {
        Os::Linux => {
            let data = env
                .var("XDG_DATA_HOME")
                .unwrap_or_else(|| home.join(".local/share"));
            let cache = env
                .var("XDG_CACHE_HOME")
                .unwrap_or_else(|| home.join(".cache"));
            add(Voxtype, data.join("voxtype/models"));
            add(WhisperCpp, home.join("whisper.cpp/models"));
            add(WhisperCpp, PathBuf::from("/usr/share/whisper.cpp/models"));
            add(
                WhisperCpp,
                PathBuf::from("/usr/local/share/whisper.cpp/models"),
            );
            add(Pywhispercpp, data.join("pywhispercpp/models"));
            add(Buzz, cache.join("Buzz/models"));
            add(
                HuggingFace,
                hf.unwrap_or_else(|| cache.join("huggingface/hub")),
            );
        }
        Os::MacOs => {
            let support = home.join("Library/Application Support");
            add(WhisperCpp, home.join("whisper.cpp/models"));
            add(WhisperCpp, PathBuf::from("/opt/homebrew/share/whisper-cpp"));
            add(WhisperCpp, PathBuf::from("/usr/local/share/whisper-cpp"));
            add(Pywhispercpp, support.join("pywhispercpp/models"));
            add(MacWhisper, support.join("MacWhisper/models"));
            add(Buzz, home.join("Library/Caches/Buzz/models"));
            add(
                HuggingFace,
                hf.unwrap_or_else(|| home.join(".cache/huggingface/hub")),
            );
        }
        Os::Windows => {
            let local = env
                .var("LOCALAPPDATA")
                .unwrap_or_else(|| home.join("AppData").join("Local"));
            add(WhisperCpp, home.join("whisper.cpp").join("models"));
            add(
                Pywhispercpp,
                local
                    .join("pywhispercpp")
                    .join("pywhispercpp")
                    .join("models"),
            );
            add(
                Buzz,
                local.join("Buzz").join("Buzz").join("Cache").join("models"),
            );
            add(
                HuggingFace,
                hf.unwrap_or_else(|| home.join(".cache").join("huggingface").join("hub")),
            );
        }
    }
    out
}

/// `ggml` as the little-endian u32 whisper.cpp checks first (`GGML_FILE_MAGIC`).
const GGML_MAGIC: u32 = 0x6767_6d6c;
const HEADER_LEN: usize = 48;
/// How deep and how wide a folder is searched, so a huge cache cannot stall the app.
const MAX_DEPTH: usize = 6;
const MAX_ENTRIES: usize = 20_000;

/// What the header of a whisper ggml model says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelHeader {
    pub multilingual: bool,
    pub audio_layers: i32,
}

/// Reads the first 48 bytes and checks they are a whisper model header: the ggml magic followed by
/// whisper's hyper-parameters. Anything else (other ggml models, GGUF, PyTorch, CTranslate2) is `None`.
pub fn read_header(path: &Path) -> Option<ModelHeader> {
    let mut buf = [0u8; HEADER_LEN];
    File::open(path).ok()?.read_exact(&mut buf).ok()?;
    let word = |i: usize| i32::from_le_bytes(buf[i * 4..i * 4 + 4].try_into().unwrap_or([0; 4]));
    if word(0) as u32 != GGML_MAGIC {
        return None;
    }
    let [n_vocab, n_audio_ctx, n_audio_state, n_audio_head, n_audio_layer, n_text_ctx, n_text_state, n_text_head, n_text_layer, n_mels, _ftype] =
        std::array::from_fn(|i| word(i + 1));
    let ok = (51_864..=51_866).contains(&n_vocab)
        && n_audio_ctx == 1_500
        && n_text_ctx == 448
        && matches!(n_mels, 80 | 128)
        && n_audio_state == n_text_state
        && (1..=64).contains(&n_audio_layer)
        && (1..=64).contains(&n_text_layer)
        && (1..=64).contains(&n_audio_head)
        && (1..=64).contains(&n_text_head)
        && (1..=4096).contains(&n_audio_state);
    ok.then_some(ModelHeader {
        // whisper.cpp: `is_multilingual = n_vocab >= 51865`.
        multilingual: n_vocab >= 51_865,
        audio_layers: n_audio_layer,
    })
}

/// Searches every location and returns the models found, preferred first.
pub fn scan(locations: &[ModelLocation]) -> ModelList {
    let mut models = Vec::new();
    let searched = walk_all(locations, &mut |found| {
        if !found.name.to_ascii_lowercase().ends_with(".bin") {
            return false;
        }
        let Some(header) = read_header(found.path) else {
            return false;
        };
        models.push(SpeechModel {
            id: found.path.to_string_lossy().into_owned(),
            name: found.name.to_owned(),
            size_bytes: found.size_bytes,
            source: found.source,
            multilingual: header.multilingual,
            folder: found.folder.to_string_lossy().into_owned(),
        });
        true
    });
    models.sort_by(|a, b| {
        b.multilingual
            .cmp(&a.multilingual)
            .then(a.size_bytes.cmp(&b.size_bytes))
            .then(a.id.cmp(&b.id))
    });
    ModelList { models, searched }
}

/// A regular file found by [`walk_all`] (a link already resolved inside its folder).
struct Found<'a> {
    /// Canonical path.
    path: &'a Path,
    name: &'a str,
    folder: &'a Path,
    source: ModelSource,
    size_bytes: u64,
}

/// Walks every location, read-only, and offers each file once to `take` (which returns whether it
/// took it). Returns the searched folders.
fn walk_all(locations: &[ModelLocation], take: &mut dyn FnMut(&Found<'_>) -> bool) -> Vec<String> {
    let mut seen = HashSet::new();
    for loc in locations {
        let Ok(root) = fs::canonicalize(&loc.path) else {
            continue;
        };
        let mut budget = MAX_ENTRIES;
        walk(&root, &root, loc.source, 0, &mut budget, &mut seen, take);
    }
    locations
        .iter()
        .map(|l| l.path.to_string_lossy().into_owned())
        .collect()
}

fn walk(
    root: &Path,
    dir: &Path,
    source: ModelSource,
    depth: usize,
    budget: &mut usize,
    seen: &mut HashSet<PathBuf>,
    take: &mut dyn FnMut(&Found<'_>) -> bool,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.filter_map(Result::ok).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        if *budget == 0 {
            return;
        }
        *budget -= 1;
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        let target = if meta.file_type().is_symlink() {
            // Follow a link only to a file inside the scanned folder.
            match fs::canonicalize(&path) {
                Ok(t) if t.starts_with(root) && t.is_file() => t,
                _ => continue,
            }
        } else if meta.is_dir() {
            if depth < MAX_DEPTH {
                walk(root, &path, source, depth + 1, budget, seen, take);
            }
            continue;
        } else if meta.is_file() {
            match fs::canonicalize(&path) {
                Ok(t) => t,
                Err(_) => continue,
            }
        } else {
            continue;
        };
        if seen.contains(&target) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let found = Found {
            path: &target,
            name: &name,
            folder: dir,
            source,
            size_bytes: fs::metadata(&target).map(|m| m.len()).unwrap_or(0),
        };
        if take(&found) {
            seen.insert(target);
        }
    }
}

/// The model to load: the one with `id` if the scan found it, else the preferred one.
pub fn choose<'a>(list: &'a ModelList, id: Option<&str>) -> Option<&'a SpeechModel> {
    id.and_then(|id| list.models.iter().find(|m| m.id == id))
        .or_else(|| list.models.first())
}

// ---- speaker models ---------------------------------------------------------------------------------

/// A usable speaker-embedding model file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerModel {
    /// Stable id: the canonical path. The core accepts only ids from its own scan.
    pub id: String,
    /// File name, e.g. `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`.
    pub name: String,
    pub size_bytes: u64,
    pub source: ModelSource,
    /// Folder the file is in, shown so a person can find it.
    pub folder: String,
}

/// The speaker models found (smaller first: the board PC is slow) and every folder searched.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerModelList {
    pub models: Vec<SpeakerModel>,
    pub searched: Vec<String>,
}

/// Searches every location for sherpa-onnx speaker-embedding models.
pub fn scan_speaker(locations: &[ModelLocation]) -> SpeakerModelList {
    let mut models = Vec::new();
    let searched = walk_all(locations, &mut |found| {
        if !found.name.to_ascii_lowercase().ends_with(".onnx")
            || read_speaker_meta(found.path).is_none()
        {
            return false;
        }
        models.push(SpeakerModel {
            id: found.path.to_string_lossy().into_owned(),
            name: found.name.to_owned(),
            size_bytes: found.size_bytes,
            source: found.source,
            folder: found.folder.to_string_lossy().into_owned(),
        });
        true
    });
    models.sort_by(|a, b| a.size_bytes.cmp(&b.size_bytes).then(a.id.cmp(&b.id)));
    SpeakerModelList { models, searched }
}

/// The speaker model to load: the one with `id` if the scan found it, else the preferred one.
pub fn choose_speaker<'a>(
    list: &'a SpeakerModelList,
    id: Option<&str>,
) -> Option<&'a SpeakerModel> {
    id.and_then(|id| list.models.iter().find(|m| m.id == id))
        .or_else(|| list.models.first())
}

/// What the metadata of a sherpa-onnx speaker-embedding model says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpeakerMeta {
    /// `3d-speaker`, `wespeaker` or `nemo`.
    pub framework: String,
    pub output_dim: u32,
}

const SPEAKER_FRAMEWORKS: [&str; 3] = ["3d-speaker", "wespeaker", "nemo"];
/// `ModelProto.metadata_props`.
const ONNX_METADATA_FIELD: u64 = 14;
/// Most top-level fields and most bytes of one metadata entry read; real models have a handful.
const ONNX_MAX_FIELDS: usize = 4_096;
const ONNX_MAX_ENTRY: u64 = 64 * 1024;

/// Reads the top level of an ONNX `ModelProto` without loading the graph, and returns its speaker
/// metadata if it is a sherpa-onnx speaker-embedding model for 16 kHz audio.
pub fn read_speaker_meta(path: &Path) -> Option<SpeakerMeta> {
    use std::io::{BufReader, Seek, SeekFrom};
    let file = File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let mut r = BufReader::new(file);
    let mut pos = 0u64;
    let mut props: Vec<(String, String)> = Vec::new();
    for n in 0..ONNX_MAX_FIELDS {
        if pos == len {
            break;
        }
        let tag = read_varint(&mut r, &mut pos)?;
        let (field, wire) = (tag >> 3, tag & 7);
        // A ModelProto starts with its ir_version (field 1, varint).
        if n == 0 && tag != 0x08 {
            return None;
        }
        if field == 0 {
            return None;
        }
        let skip = match wire {
            0 => {
                let value = read_varint(&mut r, &mut pos)?;
                if n == 0 && !(3..=64).contains(&value) {
                    return None;
                }
                0
            }
            1 => 8,
            5 => 4,
            2 => {
                let size = read_varint(&mut r, &mut pos)?;
                if size > len.saturating_sub(pos) {
                    return None; // cut off
                }
                if field == ONNX_METADATA_FIELD && size <= ONNX_MAX_ENTRY {
                    let mut buf = vec![0u8; size as usize];
                    r.read_exact(&mut buf).ok()?;
                    pos += size;
                    props.push(parse_entry(&buf)?);
                    0
                } else {
                    size
                }
            }
            _ => return None,
        };
        if skip > 0 {
            if skip > len.saturating_sub(pos) {
                return None;
            }
            r.seek(SeekFrom::Current(i64::try_from(skip).ok()?)).ok()?;
            pos += skip;
        }
    }
    if pos != len {
        return None;
    }
    let get = |k: &str| {
        props
            .iter()
            .find(|(key, _)| key == k)
            .map(|(_, v)| v.as_str())
    };
    let framework = get("framework").filter(|f| SPEAKER_FRAMEWORKS.contains(f))?;
    if get("sample_rate")? != "16000" {
        return None;
    }
    let output_dim: u32 = get("output_dim")?.parse().ok()?;
    (1..=8_192).contains(&output_dim).then(|| SpeakerMeta {
        framework: framework.to_owned(),
        output_dim,
    })
}

fn read_varint(r: &mut impl Read, pos: &mut u64) -> Option<u64> {
    let mut value = 0u64;
    for shift in (0..64).step_by(7) {
        let mut b = [0u8; 1];
        r.read_exact(&mut b).ok()?;
        *pos += 1;
        value |= u64::from(b[0] & 0x7f) << shift;
        if b[0] & 0x80 == 0 {
            return Some(value);
        }
    }
    None
}

/// A `StringStringEntryProto` (`key` = 1, `value` = 2).
fn parse_entry(buf: &[u8]) -> Option<(String, String)> {
    let mut r = buf;
    let mut pos = 0u64;
    let (mut key, mut value) = (String::new(), String::new());
    while !r.is_empty() {
        let tag = read_varint(&mut r, &mut pos)?;
        if tag & 7 != 2 {
            return None;
        }
        let size = usize::try_from(read_varint(&mut r, &mut pos)?).ok()?;
        if size > r.len() {
            return None;
        }
        let text = std::str::from_utf8(&r[..size]).ok()?.to_owned();
        r = &r[size..];
        match tag >> 3 {
            1 => key = text,
            2 => value = text,
            _ => {}
        }
    }
    Some((key, value))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A file with a whisper ggml header: `multilingual` picks the vocabulary size, `pad` adds bytes.
    pub fn fake_model(path: &Path, multilingual: bool, pad: usize) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let n_vocab = if multilingual { 51_865 } else { 51_864 };
        let words: [i32; 12] = [
            GGML_MAGIC as i32,
            n_vocab,
            1_500,
            512,
            8,
            6,
            448,
            512,
            8,
            6,
            80,
            1,
        ];
        let mut bytes: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
        bytes.extend(std::iter::repeat_n(0u8, pad));
        fs::write(path, bytes).unwrap();
    }

    fn loc(source: ModelSource, path: &Path) -> ModelLocation {
        ModelLocation {
            source,
            path: path.to_path_buf(),
        }
    }

    #[test]
    fn finds_valid_models_and_prefers_a_multilingual_one() {
        let d = tempfile::tempdir().unwrap();
        let vox = d.path().join("voxtype/models");
        fake_model(&vox.join("ggml-base.en.bin"), false, 10);
        fake_model(&vox.join("ggml-small.bin"), true, 400);
        fake_model(&vox.join("ggml-base.bin"), true, 100);
        let list = scan(&[loc(ModelSource::Voxtype, &vox)]);
        let names: Vec<_> = list.models.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(
            names,
            ["ggml-base.bin", "ggml-small.bin", "ggml-base.en.bin"]
        );
        assert!(list.models[0].multilingual);
        assert!(!list.models[2].multilingual);
        assert_eq!(list.models[0].size_bytes, 148);
        assert_eq!(list.models[0].source, ModelSource::Voxtype);
        assert_eq!(choose(&list, None).unwrap().name, "ggml-base.bin");
        let en = list.models[2].id.clone();
        assert_eq!(choose(&list, Some(&en)).unwrap().name, "ggml-base.en.bin");
        // An id the scan did not find (a path from anywhere) is never chosen.
        assert_eq!(
            choose(&list, Some("/etc/passwd")).unwrap().name,
            "ggml-base.bin"
        );
    }

    #[test]
    fn ignores_files_that_are_not_whisper_ggml_models() {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("models");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("empty.bin"), b"").unwrap();
        fs::write(dir.join("short.bin"), b"lmgg").unwrap();
        fs::write(
            dir.join("gguf.bin"),
            [b"GGUF".as_slice(), &[0u8; 60]].concat(),
        )
        .unwrap();
        fs::write(dir.join("model.bin"), vec![7u8; 4096]).unwrap();
        // ggml magic but the hyper-parameters of another model (e.g. a llama ggml file).
        let mut other: Vec<u8> = GGML_MAGIC.to_le_bytes().to_vec();
        for w in [32_000i32, 4096, 32, 32, 32, 0, 0, 0, 0, 0, 1] {
            other.extend(w.to_le_bytes());
        }
        fs::write(dir.join("llama.bin"), other).unwrap();
        // A valid header under another extension is not looked at.
        fake_model(&dir.join("ggml-base.pt"), true, 0);
        let list = scan(&[loc(ModelSource::App, &dir)]);
        assert!(list.models.is_empty(), "{:?}", list.models);
        assert_eq!(list.searched, vec![dir.to_string_lossy().into_owned()]);
    }

    #[test]
    fn scanning_changes_nothing() {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("m");
        fake_model(&dir.join("ggml-tiny.bin"), true, 0);
        let before = fs::read(dir.join("ggml-tiny.bin")).unwrap();
        let mtime = fs::metadata(dir.join("ggml-tiny.bin"))
            .unwrap()
            .modified()
            .unwrap();
        scan(&[loc(ModelSource::App, &dir)]);
        assert_eq!(fs::read(dir.join("ggml-tiny.bin")).unwrap(), before);
        assert_eq!(
            fs::metadata(dir.join("ggml-tiny.bin"))
                .unwrap()
                .modified()
                .unwrap(),
            mtime
        );
        let names: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names.len(), 1);
    }

    #[test]
    fn missing_folders_are_listed_as_searched_and_skipped() {
        let d = tempfile::tempdir().unwrap();
        let list = scan(&[
            loc(ModelSource::App, &d.path().join("nope")),
            loc(ModelSource::Voxtype, &d.path().join("nope2")),
        ]);
        assert!(list.models.is_empty());
        assert_eq!(list.searched.len(), 2);
    }

    #[cfg(unix)]
    #[test]
    fn hugging_face_snapshot_links_inside_the_cache_are_followed_once() {
        use std::os::unix::fs::symlink;
        let d = tempfile::tempdir().unwrap();
        let hub = d.path().join("hub");
        let repo = hub.join("models--ggerganov--whisper.cpp");
        fake_model(&repo.join("blobs/abc123"), true, 0);
        let snap = repo.join("snapshots/rev1");
        fs::create_dir_all(&snap).unwrap();
        symlink("../../blobs/abc123", snap.join("ggml-base.bin")).unwrap();
        let list = scan(&[loc(ModelSource::HuggingFace, &hub)]);
        assert_eq!(list.models.len(), 1);
        assert_eq!(list.models[0].name, "ggml-base.bin");
        assert_eq!(list.models[0].source, ModelSource::HuggingFace);
    }

    #[cfg(unix)]
    #[test]
    fn links_out_of_the_scanned_folder_are_not_followed() {
        use std::os::unix::fs::symlink;
        let d = tempfile::tempdir().unwrap();
        let outside = d.path().join("outside");
        fake_model(&outside.join("ggml-secret.bin"), true, 0);
        let dir = d.path().join("models");
        fs::create_dir_all(&dir).unwrap();
        symlink(outside.join("ggml-secret.bin"), dir.join("ggml-link.bin")).unwrap();
        symlink(&outside, dir.join("linked-folder")).unwrap();
        let list = scan(&[loc(ModelSource::App, &dir)]);
        assert!(list.models.is_empty(), "{:?}", list.models);
    }

    #[test]
    fn the_same_file_in_two_locations_is_listed_once() {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("m");
        fake_model(&dir.join("ggml-base.bin"), true, 0);
        let list = scan(&[
            loc(ModelSource::App, &dir),
            loc(ModelSource::WhisperCpp, &dir),
        ]);
        assert_eq!(list.models.len(), 1);
        assert_eq!(list.models[0].source, ModelSource::App);
    }

    #[test]
    fn locations_cover_the_app_voxtype_whisper_cpp_and_hugging_face_on_each_os() {
        let env = Env {
            app_data: PathBuf::from("/data/app"),
            home: Some(PathBuf::from("/home/u")),
            vars: vec![],
        };
        let linux = locations_for(Os::Linux, &env);
        let paths: Vec<_> = linux.iter().map(|l| l.path.clone()).collect();
        assert_eq!(paths[0], PathBuf::from("/data/app/models"));
        assert!(paths.contains(&PathBuf::from("/home/u/.local/share/voxtype/models")));
        assert!(paths.contains(&PathBuf::from("/home/u/.cache/huggingface/hub")));
        assert!(paths.contains(&PathBuf::from("/home/u/.local/share/pywhispercpp/models")));
        assert!(linux.iter().any(|l| l.source == ModelSource::WhisperCpp));

        let mac = locations_for(Os::MacOs, &env);
        assert!(mac.iter().any(
            |l| l.path == Path::new("/home/u/Library/Application Support/pywhispercpp/models")
        ));
        assert!(mac.iter().any(|l| l.source == ModelSource::HuggingFace));

        let win = locations_for(Os::Windows, &env);
        assert!(win.iter().any(|l| l.source == ModelSource::HuggingFace));
        assert!(win.iter().any(|l| l.source == ModelSource::Pywhispercpp));

        let moved = Env {
            vars: vec![
                ("XDG_DATA_HOME".into(), "/xdg/data".into()),
                ("HF_HOME".into(), "/hf".into()),
            ],
            ..env.clone()
        };
        let paths: Vec<_> = locations_for(Os::Linux, &moved)
            .into_iter()
            .map(|l| l.path)
            .collect();
        assert!(paths.contains(&PathBuf::from("/xdg/data/voxtype/models")));
        assert!(paths.contains(&PathBuf::from("/hf/hub")));

        let no_home = Env { home: None, ..env };
        assert_eq!(locations_for(Os::Linux, &no_home).len(), 1);
    }

    // ---- speaker models -----------------------------------------------------------------------------

    fn varint(mut v: u64, out: &mut Vec<u8>) {
        loop {
            let b = (v & 0x7f) as u8;
            v >>= 7;
            if v == 0 {
                out.push(b);
                return;
            }
            out.push(b | 0x80);
        }
    }

    fn field(num: u64, bytes: &[u8], out: &mut Vec<u8>) {
        varint(num << 3 | 2, out);
        varint(bytes.len() as u64, out);
        out.extend_from_slice(bytes);
    }

    /// The top level of an ONNX `ModelProto` as exporters write it: ir_version, producer, opset, a
    /// graph of `graph_len` bytes, then the metadata entries.
    pub fn fake_onnx(path: &Path, props: &[(&str, &str)], graph_len: usize) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut b = vec![0x08, 8]; // ir_version 8
        field(2, b"pytorch", &mut b);
        let mut opset = Vec::new();
        opset.extend_from_slice(&[0x10, 17]); // version 17
        field(8, &opset, &mut b);
        field(7, &vec![0x5a; graph_len], &mut b);
        for (k, v) in props {
            let mut entry = Vec::new();
            field(1, k.as_bytes(), &mut entry);
            field(2, v.as_bytes(), &mut entry);
            field(14, &entry, &mut b);
        }
        fs::write(path, b).unwrap();
    }

    const CAMPPLUS: [(&str, &str); 6] = [
        ("framework", "3d-speaker"),
        ("language", "Chinese/English"),
        ("output_dim", "192"),
        ("sample_rate", "16000"),
        ("normalize_samples", "1"),
        ("comment", "campplus"),
    ];

    #[test]
    fn a_speaker_model_is_listed_with_id_name_size_source_and_folder() {
        let d = tempfile::tempdir().unwrap();
        let app = d.path().join("app/models");
        let big = app.join("3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx");
        let small = app.join("3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx");
        fake_onnx(&big, &CAMPPLUS, 9_000);
        fake_onnx(&small, &CAMPPLUS, 2_000);
        let nemo = d
            .path()
            .join("hub/models--k2/snapshots/1/nemo_en_titanet_small.onnx");
        fake_onnx(
            &nemo,
            &[
                ("framework", "nemo"),
                ("output_dim", "192"),
                ("sample_rate", "16000"),
                ("feat_dim", "80"),
            ],
            5_000,
        );
        let list = scan_speaker(&[
            loc(ModelSource::App, &app),
            loc(ModelSource::HuggingFace, &d.path().join("hub")),
        ]);
        let names: Vec<_> = list.models.iter().map(|m| m.name.as_str()).collect();
        // Smaller first.
        assert_eq!(
            names,
            [
                "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
                "nemo_en_titanet_small.onnx",
                "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
            ]
        );
        let first = &list.models[0];
        assert_eq!(
            first.id,
            fs::canonicalize(&small).unwrap().to_string_lossy()
        );
        assert_eq!(first.size_bytes, fs::metadata(&small).unwrap().len());
        assert_eq!(first.source, ModelSource::App);
        assert_eq!(
            first.folder,
            fs::canonicalize(&app).unwrap().to_string_lossy()
        );
        assert_eq!(list.models[1].source, ModelSource::HuggingFace);
        assert_eq!(
            read_speaker_meta(&nemo).unwrap(),
            SpeakerMeta {
                framework: "nemo".into(),
                output_dim: 192
            }
        );
        assert_eq!(list.searched.len(), 2);
        // The core accepts only ids from its own scan.
        assert_eq!(choose_speaker(&list, None).unwrap().id, first.id);
        assert_eq!(
            choose_speaker(&list, Some(&list.models[2].id))
                .unwrap()
                .name,
            list.models[2].name
        );
        assert_eq!(
            choose_speaker(&list, Some("/etc/passwd")).unwrap().id,
            first.id
        );
    }

    #[test]
    fn other_onnx_models_ggml_truncated_and_foreign_files_are_not_speaker_models() {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("models");
        // Silero VAD: no metadata at all.
        fake_onnx(&dir.join("silero_vad.onnx"), &[], 3_000);
        // A Piper / VITS voice: TTS metadata at 22.05 kHz.
        fake_onnx(
            &dir.join("de_DE-thorsten-high.onnx"),
            &[
                ("model_type", "vits"),
                ("sample_rate", "22050"),
                ("language", "de"),
            ],
            3_000,
        );
        // A streaming ASR encoder: ASR metadata, no framework.
        fake_onnx(
            &dir.join("encoder-epoch-99-avg-1.onnx"),
            &[
                ("model_type", "zipformer2"),
                ("T", "45"),
                ("decode_chunk_len", "32"),
            ],
            3_000,
        );
        // A source-separation model with an unknown framework, and a speaker model for 8 kHz.
        fake_onnx(
            &dir.join("UVR-MDX-NET-Inst_HQ_3.onnx"),
            &[
                ("framework", "mdx"),
                ("sample_rate", "44100"),
                ("output_dim", "2"),
            ],
            3_000,
        );
        fake_onnx(
            &dir.join("wespeaker_8k.onnx"),
            &[
                ("framework", "wespeaker"),
                ("sample_rate", "8000"),
                ("output_dim", "256"),
            ],
            3_000,
        );
        // Speaker metadata but no output_dim.
        fake_onnx(
            &dir.join("no_dim.onnx"),
            &[("framework", "wespeaker"), ("sample_rate", "16000")],
            3_000,
        );
        // A whisper ggml model renamed to .onnx, and random bytes.
        fake_model(&dir.join("ggml-base.onnx"), true, 200);
        fs::write(dir.join("random.onnx"), vec![0x08u8; 64]).unwrap();
        fs::write(dir.join("empty.onnx"), b"").unwrap();
        // A real-looking speaker model cut off in the middle of its graph.
        let full = d.path().join("full.onnx");
        fake_onnx(&full, &CAMPPLUS, 5_000);
        let bytes = fs::read(&full).unwrap();
        fs::write(dir.join("truncated.onnx"), &bytes[..2_000]).unwrap();
        // ...and cut off inside its metadata.
        fs::write(dir.join("cut-meta.onnx"), &bytes[..bytes.len() - 3]).unwrap();
        // A valid speaker model under another extension is not looked at.
        fs::write(dir.join("speaker.bin"), &bytes).unwrap();
        let list = scan_speaker(&[loc(ModelSource::App, &dir)]);
        assert!(list.models.is_empty(), "{:?}", list.models);
        assert!(read_speaker_meta(&full).is_some());
        // A whisper scan of the same folder does not list ONNX files either.
        assert!(scan(&[loc(ModelSource::App, &dir)]).models.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn a_speaker_model_linked_from_outside_the_folder_is_not_listed() {
        use std::os::unix::fs::symlink;
        let d = tempfile::tempdir().unwrap();
        let outside = d.path().join("outside/speaker.onnx");
        fake_onnx(&outside, &CAMPPLUS, 100);
        let dir = d.path().join("models");
        fs::create_dir_all(&dir).unwrap();
        symlink(&outside, dir.join("speaker.onnx")).unwrap();
        symlink(outside.parent().unwrap(), dir.join("linked")).unwrap();
        assert!(scan_speaker(&[loc(ModelSource::App, &dir)])
            .models
            .is_empty());
        // Inside the folder (the Hugging Face snapshot layout), a link is followed once.
        let hub = d.path().join("hub");
        fake_onnx(&hub.join("blobs/abc"), &CAMPPLUS, 100);
        fs::create_dir_all(hub.join("snapshots/1")).unwrap();
        symlink("../../blobs/abc", hub.join("snapshots/1/campplus.onnx")).unwrap();
        let list = scan_speaker(&[loc(ModelSource::HuggingFace, &hub)]);
        assert_eq!(list.models.len(), 1);
        assert_eq!(list.models[0].name, "campplus.onnx");
    }

    #[test]
    fn the_speaker_scan_never_writes_copies_or_moves_anything() {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("m");
        let file = dir.join("campplus.onnx");
        fake_onnx(&file, &CAMPPLUS, 1_000);
        fake_onnx(&dir.join("vad.onnx"), &[], 1_000);
        let snapshot = || {
            let mut all: Vec<_> = fs::read_dir(&dir)
                .unwrap()
                .map(|e| {
                    let p = e.unwrap().path();
                    let m = fs::metadata(&p).unwrap();
                    (
                        p.clone(),
                        fs::read(&p).unwrap(),
                        m.modified().unwrap(),
                        m.len(),
                    )
                })
                .collect();
            all.sort();
            all
        };
        let before = snapshot();
        assert_eq!(scan_speaker(&[loc(ModelSource::App, &dir)]).models.len(), 1);
        assert_eq!(snapshot(), before);
    }

    #[test]
    fn speaker_models_are_searched_in_the_app_folder_and_the_hugging_face_cache_only() {
        let env = Env {
            app_data: PathBuf::from("/data/app"),
            home: Some(PathBuf::from("/home/u")),
            vars: vec![],
        };
        for os in [Os::Linux, Os::MacOs, Os::Windows] {
            let all = locations_for(os, &env);
            let speaker = locations_of(ModelKind::Speaker, os, &env);
            assert_eq!(speaker[0].path, PathBuf::from("/data/app/models"));
            assert!(speaker
                .iter()
                .all(|l| matches!(l.source, ModelSource::App | ModelSource::HuggingFace)));
            assert_eq!(speaker.len(), 2, "{os:?}");
            // Taken from the one list, in its order.
            assert!(speaker.iter().all(|l| all.contains(l)));
            assert_eq!(locations_of(ModelKind::Whisper, os, &env), all);
        }
    }
}
