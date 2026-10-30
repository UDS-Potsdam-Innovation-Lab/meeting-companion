//! Finds whisper.cpp speech models that are already on this device.
//!
//! The app downloads nothing. It looks, read-only, in the folders listed in [`locations_for`] (the one
//! place that names them), takes a file as a model only if its header is a whisper model in the ggml
//! format that whisper.cpp loads, and refers to it by path. Found files are never copied, moved or
//! changed. Symbolic links are followed only when their target stays inside the scanned folder (the
//! Hugging Face cache links snapshots to blobs in the same folder); linked folders are not entered.
//!
//! GGUF files are not offered: the whisper.cpp version bundled with `whisper-rs` loads only the ggml
//! format (`GGML_FILE_MAGIC`), so a GGUF file would be listed but could never be loaded.

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
    let mut seen = HashSet::new();
    let mut models = Vec::new();
    for loc in locations {
        let Ok(root) = fs::canonicalize(&loc.path) else {
            continue;
        };
        let mut budget = MAX_ENTRIES;
        walk(
            &root,
            &root,
            loc.source,
            0,
            &mut budget,
            &mut seen,
            &mut models,
        );
    }
    models.sort_by(|a, b| {
        b.multilingual
            .cmp(&a.multilingual)
            .then(a.size_bytes.cmp(&b.size_bytes))
            .then(a.id.cmp(&b.id))
    });
    ModelList {
        models,
        searched: locations
            .iter()
            .map(|l| l.path.to_string_lossy().into_owned())
            .collect(),
    }
}

fn walk(
    root: &Path,
    dir: &Path,
    source: ModelSource,
    depth: usize,
    budget: &mut usize,
    seen: &mut HashSet<PathBuf>,
    out: &mut Vec<SpeechModel>,
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
                walk(root, &path, source, depth + 1, budget, seen, out);
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
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.to_ascii_lowercase().ends_with(".bin") || seen.contains(&target) {
            continue;
        }
        let Some(header) = read_header(&target) else {
            continue;
        };
        seen.insert(target.clone());
        out.push(SpeechModel {
            id: target.to_string_lossy().into_owned(),
            name,
            size_bytes: fs::metadata(&target).map(|m| m.len()).unwrap_or(0),
            source,
            multilingual: header.multilingual,
            folder: dir.to_string_lossy().into_owned(),
        });
    }
}

/// The model to load: the one with `id` if the scan found it, else the preferred one.
pub fn choose<'a>(list: &'a ModelList, id: Option<&str>) -> Option<&'a SpeechModel> {
    id.and_then(|id| list.models.iter().find(|m| m.id == id))
        .or_else(|| list.models.first())
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
}
