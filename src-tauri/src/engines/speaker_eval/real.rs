//! The speaker-accuracy run with a real model (`#[ignore]`):
//!
//! `MEETING_COMPANION_SPEAKER_MODEL=<model.onnx> cargo test --manifest-path src-tauri/Cargo.toml --
//! --ignored speaker_accuracy`
//!
//! Every scene goes through the transcript windowing, [`SherpaDiarizer`] and the real `VoiceTracker`;
//! the measures are compared with the thresholds committed for the model (`thresholds.json`, by file
//! name). For a model without thresholds the table is printed and nothing fails. The workflow
//! scenarios then use the real output with the `speakers` commands and the stores. Nothing is
//! downloaded: the pinned model comes from `node scripts/speaker-model.mjs fetch`.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::path::PathBuf;

use super::corpus;
use super::measures::Measures;
use super::run::{self, SceneRun};
use super::scene::{self, BuiltScene};
use crate::crypto::{DataKey, MemoryKeyProvider};
use crate::engines::sherpa::SherpaDiarizer;
use crate::model::Participant;
use crate::speakers::{
    choose_line, choose_voice, name_round, speaker_state, LineTarget, SpeakerState,
};
use crate::store::{FileMeetingStore, MeetingStore};
use crate::transcript::{TranscriptStore, Voice};

const MODEL_ENV: &str = "MEETING_COMPANION_SPEAKER_MODEL";
const NAME_ROUND_SCENE: &str = "de-name-round";

fn model() -> (PathBuf, String) {
    let path = std::env::var_os(MODEL_ENV).map(PathBuf::from).unwrap_or_else(|| {
        panic!(
            "set {MODEL_ENV}=<model.onnx>: `node scripts/speaker-model.mjs fetch` fetches the pinned \
             model and `node scripts/speaker-model.mjs path` prints its path. This test never downloads."
        )
    });
    assert!(
        path.is_file(),
        "{MODEL_ENV} does not name a model file: {}",
        path.display()
    );
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    (path, name)
}

fn load(path: &std::path::Path) -> SherpaDiarizer {
    SherpaDiarizer::load(path)
        .unwrap_or_else(|e| panic!("{MODEL_ENV}: the model does not load ({e})"))
}

/// Writes to the real stderr, so the table shows without `--nocapture`.
fn show(text: &str) {
    let _ = writeln!(std::io::stderr(), "{text}");
}

/// The voice most of `lines` got (ties: the first label), if any.
fn majority(voices: impl Iterator<Item = Option<Voice>>) -> Option<Voice> {
    let mut count: BTreeMap<Voice, usize> = BTreeMap::new();
    for v in voices.flatten() {
        *count.entry(v).or_default() += 1;
    }
    count
        .into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(&a.0)))
        .map(|(v, _)| v)
}

/// The scene-specific checks: a returning voice keeps its label; a few-words speaker never gets
/// another speaker's label. Returns failures and notes.
fn scene_checks(s: &BuiltScene, run: &SceneRun, m: &Measures) -> (Vec<String>, Vec<String>) {
    let (mut failures, mut notes) = (Vec::new(), Vec::new());
    // The name round: at most one extra voice (7 for 6 at SAME_VOICE 0.55, accepted in job 015).
    if s.id == "de-name-round" && m.voices > m.speakers + 1 {
        failures.push(format!(
            "{}: {} voices for {} speakers, at most one extra voice allowed",
            s.id, m.voices, m.speakers
        ));
    }
    for sp in s.speakers() {
        let mine = scene::turns_of(&s.turns, &sp);
        // Returning after a pause of at least 60 s.
        if scene::longest_return_gap(&s.turns, &sp) >= 60_000 {
            let mut end = 0;
            let mut split = None;
            for t in &mine {
                if end > 0 && t.start_ms.saturating_sub(end) >= 60_000 {
                    split = Some((end, t.start_ms));
                    break;
                }
                end = end.max(t.end_ms);
            }
            let (gap_start, gap_end) = split.expect("a pause");
            let of = |before: bool| {
                majority(run.lines.iter().zip(&m.lines).filter_map(|(l, r)| {
                    let side = if before {
                        l.end_ms <= gap_start
                    } else {
                        l.start_ms >= gap_end
                    };
                    (side && !r.mixed && r.reference.as_deref() == Some(sp.as_str()))
                        .then_some(l.voice)
                }))
            };
            let (before, after) = (of(true), of(false));
            if before.is_none() || before != after {
                failures.push(format!(
                    "{}: the voice back after the pause is {:?}, before it was {:?}",
                    s.id,
                    after.map(|v| v.label()),
                    before.map(|v| v.label())
                ));
            }
            notes.push(format!(
                "{}: returning voice {:?} → {:?}",
                s.id,
                before.map(|v| v.label()),
                after.map(|v| v.label())
            ));
        }
        // Says only a few words.
        if scene::speech_ms(&s.turns, &sp) <= 2_000 {
            for (l, r) in run.lines.iter().zip(&m.lines) {
                if r.reference.as_deref() != Some(sp.as_str()) {
                    continue;
                }
                let label = l.voice.map(|v| v.label().to_string());
                match r.mapped.as_deref() {
                    Some(other) if other != sp => failures.push(format!(
                        "{}: the few-words speaker got the voice {} of another speaker",
                        s.id,
                        label.unwrap_or_default()
                    )),
                    Some(_) => notes.push(format!("{}: few-words speaker has its own voice", s.id)),
                    None => notes.push(format!(
                        "{}: few-words speaker has {}",
                        s.id,
                        if label.is_some() {
                            "a new voice"
                        } else {
                            "no voice"
                        }
                    )),
                }
            }
        }
    }
    (failures, notes)
}

/// No log line holds a name, a turn's text or a number that could be part of an embedding.
fn assert_logs_clean(lines: &[String]) {
    let mut secrets: BTreeSet<String> = BTreeSet::new();
    for s in scene::all() {
        secrets.extend(s.participants.iter().map(|p| p.name.clone()));
        secrets.extend(
            s.turns
                .iter()
                .flat_map(|t| t.text.split_whitespace())
                .filter(|w| w.chars().count() >= 6)
                .map(str::to_owned),
        );
    }
    for line in lines {
        for secret in &secrets {
            assert!(!line.contains(secret.as_str()), "logged content: {line}");
        }
        let b = line.as_bytes();
        let decimal = b.windows(4).any(|w| {
            w[0].is_ascii_digit() && w[1] == b'.' && w[2].is_ascii_digit() && w[3].is_ascii_digit()
        });
        assert!(!decimal, "logged a number: {line}");
    }
}

/// AC4: accuracy of the real model on every scene, against the committed thresholds.
#[test]
#[ignore]
fn speaker_accuracy_with_the_pinned_model_stays_within_the_thresholds() {
    let (path, name) = model();
    let thresholds = run::load_thresholds(&corpus::root());
    let pinned = thresholds.models.get(&name);
    if let Some(p) = pinned {
        let bytes = std::fs::read(&path).expect("model readable");
        assert_eq!(
            super::sha256::hex(&bytes),
            p.sha256,
            "{MODEL_ENV} has the pinned model's name but other content"
        );
    }
    let mut d = load(&path);
    crate::log::capture();
    let mut table = vec![
        format!("speaker accuracy: {name}"),
        run::TABLE_HEADER.to_owned(),
    ];
    let mut failures = Vec::new();
    let mut notes = Vec::new();
    let mut baseline = Vec::new();
    for s in scene::all() {
        let windows = run::windows(s);
        let r = run::run_windows(s, &windows, &mut d);
        let m = run::score(s, &r);
        table.push(run::table_row(&s.id, &m, r.per_segment()));
        baseline.push(format!(
            "\"{}\": {{ \"der\": {:.4}, \"missed\": {:.4}, \"falseAlarm\": {:.4}, \"confusion\": {:.4}, \"lineAccuracy\": {:.4} }}",
            s.id,
            m.der(),
            m.missed(),
            m.false_alarm(),
            m.confusion(),
            m.line_accuracy()
        ));
        if let Some(p) = pinned {
            match p.scenes.get(&s.id) {
                Some(t) => failures.extend(run::check(&s.id, &m, t)),
                None => failures.push(format!("{}: no thresholds for this scene", s.id)),
            }
        }
        let (f, n) = scene_checks(s, &r, &m);
        failures.extend(f);
        notes.extend(n);
    }
    let logged = crate::log::take_captured();
    table.extend(notes);
    table.push(format!("measured: {}", baseline.join(", ")));
    show(&table.join("\n"));
    assert_logs_clean(&logged);
    if pinned.is_none() {
        show(&format!(
            "no thresholds for {name}: printed only (thresholds exist for {:?})\n{}",
            thresholds.models.keys().collect::<Vec<_>>(),
            failures.join("\n")
        ));
        return;
    }
    assert!(failures.is_empty(), "regression:\n{}", failures.join("\n"));
}

/// Who is shown for a line, as the transcript does: the line's choice, else the confirmed person of
/// its voice.
fn shown(state: &SpeakerState, seq: u64, voice: Option<Voice>) -> Option<String> {
    if let Some(choice) = state.lines.iter().find(|l| l.seq == seq) {
        return choice.participant_id.clone();
    }
    let voice = voice?;
    state
        .voices
        .iter()
        .find(|c| c.voice == voice && c.confirmed)
        .and_then(|c| c.participant_id.clone())
}

/// AC5: the name round, a voice applied backwards and a "Who said this?" fix on real diarizer output.
#[test]
#[ignore]
fn speaker_accuracy_workflows_on_real_diarizer_output() {
    let (path, name) = model();
    let file = run::load_thresholds(&corpus::root());
    let thresholds = file.models.get(&name);
    let mut d = load(&path);
    let s = scene::all()
        .iter()
        .find(|s| s.id == NAME_ROUND_SCENE)
        .expect("the name-round scene");
    crate::log::capture();
    let windows = run::windows(s);
    let r = run::run_windows(s, &windows, &mut d);
    let m = run::score(s, &r);
    let segments = r.segments(run::lang_of(s));

    let participants: Vec<Participant> = s
        .participants
        .iter()
        .enumerate()
        .map(|(i, p)| Participant {
            id: format!("p-{}", i + 1),
            name: p.name.clone(),
            guest: false,
        })
        .collect();
    let person_of = |speaker: &str| -> Option<String> {
        s.participants
            .iter()
            .position(|p| p.speaker.as_deref() == Some(speaker))
            .map(|i| participants[i].id.clone())
    };
    let mut failures = Vec::new();

    // Name round: no suggestion names the wrong person, and each speaker with a voice of its own is
    // suggested as the person it introduced itself as. Speakers the model merged into one voice get
    // an unsure suggestion (nobody); how many are suggested right may not drop below the baseline.
    let suggestions = name_round(&participants, &segments);
    let own_voice = |sp: &str| {
        majority(r.lines.iter().zip(&m.lines).filter_map(|(l, x)| {
            (!x.mixed && x.reference.as_deref() == Some(sp)).then_some(l.voice)
        }))
    };
    let speakers = s.speakers();
    let voices_of: Vec<Option<Voice>> = speakers.iter().map(|sp| own_voice(sp)).collect();
    let mut suggested_right = 0;
    for (i, sp) in speakers.iter().enumerate() {
        let expected = person_of(sp);
        let got = voices_of[i].and_then(|v| {
            suggestions
                .iter()
                .find(|x| x.voice == v)
                .and_then(|x| x.person().map(str::to_owned))
        });
        let shared = voices_of[i].is_some()
            && voices_of
                .iter()
                .enumerate()
                .any(|(j, v)| j != i && *v == voices_of[i]);
        if got == expected {
            suggested_right += 1;
        } else if shared && got.is_none() {
            show(&format!(
                "name round: {sp} shares voice {:?} with another speaker; no suggestion",
                voices_of[i].map(|v| v.label())
            ));
        } else {
            failures.push(format!(
                "name round: {sp} is suggested as {got:?}, not {expected:?}"
            ));
        }
    }
    for x in &suggestions {
        let Some(p) = x.person() else { continue };
        let right: Vec<Option<String>> = speakers
            .iter()
            .zip(&voices_of)
            .filter(|(_, v)| **v == Some(x.voice))
            .map(|(sp, _)| person_of(sp))
            .collect();
        if right != [Some(p.to_owned())] {
            failures.push(format!(
                "name round: voice {} is suggested as {p}, but it is {right:?}",
                x.voice
            ));
        }
    }
    let min_right = thresholds.map(|t| t.name_round_min_suggested).unwrap_or(0);
    if suggested_right < min_right {
        failures.push(format!(
            "name round: {suggested_right} of {} speakers suggested right, baseline minimum {min_right}",
            speakers.len()
        ));
    }

    // The stores: a meeting with these people and the run's transcript, in a temp folder.
    let dir = tempfile::tempdir().unwrap();
    let keys = MemoryKeyProvider::with_key(DataKey::generate());
    let meetings = FileMeetingStore::open(dir.path(), &keys).unwrap();
    let mut meeting = crate::model::tests::running();
    meeting.participants = participants.clone();
    for item in &mut meeting.items {
        item.lead = None;
    }
    meetings.save(&meeting).unwrap();
    let transcripts = meetings.transcripts();
    let mut w = transcripts.writer(&meeting.id).unwrap();
    for seg in &segments {
        w.append(seg).unwrap();
    }
    drop(w);
    let file = dir.path().join(format!("{}.transcript", meeting.id));
    let before = std::fs::read(&file).unwrap();
    let id = meeting.id.clone();

    // Applied backwards: at the end, every voice is assigned to the person it maps to.
    let voices: BTreeSet<Voice> = r.lines.iter().filter_map(|l| l.voice).collect();
    for (n, v) in voices.iter().enumerate() {
        let person = m
            .mapping
            .get(&v.label().to_string())
            .and_then(|sp| person_of(sp));
        choose_voice(
            &meetings,
            &transcripts,
            &id,
            &v.label().to_string(),
            person.as_deref(),
            10 + n as u64,
        )
        .unwrap();
    }
    let state = speaker_state(&meetings, &transcripts, &id).unwrap();
    let expected: Vec<Option<String>> = m
        .lines
        .iter()
        .map(|l| l.reference.as_deref().and_then(person_of))
        .collect();
    let shown_all = |state: &SpeakerState| -> Vec<Option<String>> {
        r.lines
            .iter()
            .enumerate()
            .map(|(i, l)| shown(state, i as u64, l.voice))
            .collect()
    };
    let now = shown_all(&state);
    let mid = s.duration_ms() / 2;
    for (half, earlier) in [("earlier", true), ("later", false)] {
        let idx: Vec<usize> = (0..r.lines.len())
            .filter(|i| (r.lines[*i].start_ms < mid) == earlier && expected[*i].is_some())
            .collect();
        let by_person = idx.iter().filter(|i| now[**i] == expected[**i]).count();
        let by_voice = idx.iter().filter(|i| m.lines[**i].correct).count();
        if by_person != by_voice {
            failures.push(format!(
                "applied backwards: {half} lines show {by_person}/{} right people, the voices give {by_voice}",
                idx.len()
            ));
        }
    }
    for (i, l) in r.lines.iter().enumerate() {
        let assigned = l.voice.and_then(|v| {
            state
                .voices
                .iter()
                .find(|c| c.voice == v)
                .and_then(|c| c.participant_id.clone())
        });
        if assigned.is_some() && now[i] != assigned {
            failures.push(format!(
                "applied backwards: line {i} does not show its voice's person"
            ));
        }
    }

    // "Who said this?": fixing one misattributed line changes that line only.
    let wrong = (0..r.lines.len()).find(|i| expected[*i].is_some() && now[*i] != expected[*i]);
    match wrong {
        Some(i) => {
            let target = LineTarget::Person {
                participant_id: expected[i].clone().unwrap(),
            };
            let after = choose_line(&meetings, &transcripts, &id, i as u64, &target, 100).unwrap();
            assert_eq!(after.lines.len(), 1);
            let then = shown_all(&after);
            for j in 0..r.lines.len() {
                let want = if j == i { &expected[i] } else { &now[j] };
                if &then[j] != want {
                    failures.push(format!("who said this: line {j} changed (fixed line {i})"));
                }
            }
        }
        None => show("who said this: no misattributed line in this run; nothing to fix"),
    }

    if std::fs::read(&file).unwrap() != before {
        failures.push("the transcript file changed".into());
    }
    let logged = crate::log::take_captured();
    assert_logs_clean(&logged);
    show(&format!(
        "speaker workflows: {} lines, {} voices, {} suggestions, {suggested_right} of {} speakers \
         suggested right, line accuracy {:.1} %",
        r.lines.len(),
        voices.len(),
        suggestions.len(),
        speakers.len(),
        m.line_accuracy() * 100.0
    ));
    if thresholds.is_none() {
        show(&format!(
            "no thresholds for {name}: printed only\n{}",
            failures.join("\n")
        ));
        return;
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// Without a model the test names the variable to set; it never looks elsewhere or downloads.
#[test]
fn without_a_model_the_accuracy_run_names_the_env_var() {
    if std::env::var_os(MODEL_ENV).is_some() {
        return;
    }
    let err = std::panic::catch_unwind(model).unwrap_err();
    let message = err.downcast_ref::<String>().cloned().unwrap_or_default();
    assert!(message.contains(MODEL_ENV), "{message}");
    assert!(message.contains("never downloads"), "{message}");
}
