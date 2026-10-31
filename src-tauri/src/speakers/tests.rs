use super::*;
use crate::crypto::{DataKey, MemoryKeyProvider};
use crate::model::tests::running;
use crate::store::{FileMeetingStore, MemoryMeetingStore};
use crate::transcript::{Lang, MemoryTranscriptStore};

fn people() -> Vec<Participant> {
    [
        ("p-mk", "Mara Klein"),
        ("p-tb", "Tobias Brandt"),
        ("p-ya", "Yusuf Aydin"),
        ("p-jr", "Jana Roth"),
        ("p-jg", "Jürgen Groß"),
    ]
    .into_iter()
    .map(|(id, name)| Participant {
        id: id.into(),
        name: name.into(),
        guest: false,
    })
    .collect()
}

fn line(start_s: u64, voice: Option<&str>, text: &str) -> Segment {
    Segment {
        start_ms: start_s * 1_000,
        end_ms: start_s * 1_000 + 2_500,
        at: 1_700_000_000_000 + start_s * 1_000,
        text: text.into(),
        lang: Lang::En,
        is_final: true,
        voice: voice.and_then(Voice::parse),
    }
}

fn v(s: &str) -> Voice {
    Voice::parse(s).unwrap()
}

fn suggest(segments: &[Segment]) -> Vec<(char, Vec<&'static str>, bool)> {
    let ids: Vec<&'static str> = people()
        .into_iter()
        .map(|p| &*Box::leak(p.id.into_boxed_str()))
        .collect();
    name_round(&people(), segments)
        .into_iter()
        .map(|s| {
            let c = s
                .candidates
                .iter()
                .map(|id| *ids.iter().find(|i| **i == id.as_str()).unwrap())
                .collect();
            (s.voice.label(), c, s.unsure)
        })
        .collect()
}

#[test]
fn exactly_one_name_gives_a_suggestion() {
    let segs = [
        line(5, Some("A"), "Hi, I'm Mara Klein, I lead the product team."),
        line(12, Some("B"), "Tobias hier, ich mache die Technik."),
        line(20, Some("A"), "Okay, let's start."),
    ];
    assert_eq!(
        suggest(&segs),
        [('A', vec!["p-mk"], false), ('B', vec!["p-tb"], false)]
    );
    let s = &name_round(&people(), &segs)[0];
    assert_eq!(s.person(), Some("p-mk"));
}

#[test]
fn two_names_from_one_voice_or_one_name_from_two_voices_are_unsure() {
    let segs = [line(5, Some("D"), "Yusuf or Jana, one of you takes notes.")];
    assert_eq!(suggest(&segs), [('D', vec!["p-ya", "p-jr"], true)]);
    assert_eq!(name_round(&people(), &segs)[0].person(), None);

    let segs = [
        line(5, Some("A"), "I'm Yusuf."),
        line(9, Some("C"), "And Yusuf is also on the call."),
    ];
    assert_eq!(
        suggest(&segs),
        [('A', vec!["p-ya"], true), ('C', vec!["p-ya"], true)]
    );
}

#[test]
fn no_name_no_suggestion_and_names_not_on_the_invite_suggest_nobody() {
    let segs = [
        line(5, Some("A"), "Good morning everyone."),
        line(9, Some("B"), "I'm Petra from the district office."),
    ];
    assert!(suggest(&segs).is_empty());
}

#[test]
fn matching_is_case_insensitive_on_whole_words_with_umlauts_and_sharp_s_as_written() {
    let cases = [
        ("hi, i'm MARA", vec![('A', vec!["p-mk"], false)]),
        ("ich bin jürgen", vec![('A', vec!["p-jg"], false)]),
        ("ICH BIN JÜRGEN GROẞ", vec![('A', vec!["p-jg"], false)]),
        // Not whole words, and no transliteration.
        ("Marathon and Tobiasz", vec![]),
        ("Ich bin Juergen Gross", vec![]),
        ("Herr Groß ist da", vec![]),
    ];
    for (text, expected) in cases {
        assert_eq!(suggest(&[line(3, Some("A"), text)]), expected, "{text}");
    }
}

#[test]
fn only_the_first_two_minutes_and_only_lines_with_a_voice_count() {
    let segs = [
        line(119, Some("A"), "I'm Mara."),
        line(120, Some("B"), "I'm Tobias."),
        line(30, None, "I'm Jana."),
    ];
    assert_eq!(suggest(&segs), [('A', vec!["p-mk"], false)]);
}

#[test]
fn transcript_text_is_untrusted_and_only_matches_invited_names() {
    let segs = [line(
        4,
        Some("A"),
        "<img src=x onerror=alert(1)> I'm Mara Klein",
    )];
    assert_eq!(suggest(&segs), [('A', vec!["p-mk"], false)]);
    // Guests are not invited: their names suggest nobody.
    let mut ps = people();
    ps.push(Participant {
        id: "guest-1".into(),
        name: "Petra Sand".into(),
        guest: true,
    });
    assert!(name_round(&ps, &[line(4, Some("B"), "Petra here")]).is_empty());
}

// ---- commands --------------------------------------------------------------------------------------

fn meeting() -> Meeting {
    let mut m = running();
    m.participants = people();
    m.items[0].lead = None;
    m
}

fn transcript() -> Vec<Segment> {
    vec![
        line(5, Some("A"), "Hi, I'm Mara Klein."),
        line(12, Some("B"), "Tobias here."),
        line(20, Some("D"), "Yusuf or Jana will write it down."),
        line(30, None, "(short)"),
        line(40, Some("E"), "Hi, I'm from the district office."),
        line(50, Some("A"), "Okay, let's start."),
    ]
}

fn rig() -> (MemoryMeetingStore, MemoryTranscriptStore) {
    let meetings = MemoryMeetingStore::new();
    meetings.save(&meeting()).unwrap();
    let transcripts = MemoryTranscriptStore::new();
    let mut w = transcripts.writer("m-1").unwrap();
    for s in transcript() {
        w.append(&s).unwrap();
    }
    (meetings, transcripts)
}

#[test]
fn a_suggestion_changes_nothing_until_a_person_confirms_it() {
    let (m, t) = rig();
    let state = speaker_state(&m, &t, "m-1").unwrap();
    assert!(state.voices.is_empty());
    assert_eq!(state.suggestions.len(), 3);
    assert_eq!(m.load("m-1").unwrap().unwrap().speakers, None);
    // Picking the suggested person confirms it as "Name round"; someone else is "Picked by hand".
    let state = choose_voice(&m, &t, "m-1", "A", Some("p-mk"), 5).unwrap();
    assert_eq!(state.voices[0].source, NameSource::NameRound);
    assert!(state.voices[0].confirmed);
    assert!(state.suggestions.iter().all(|s| s.voice != v("A")));
    let state = choose_voice(&m, &t, "m-1", "B", Some("p-ya"), 6).unwrap();
    assert_eq!(state.voices[1].source, NameSource::Manual);
}

#[test]
fn apply_names_confirms_unique_suggestions_and_leaves_unsure_ones_open() {
    let (m, t) = rig();
    let state = apply_name_round(&m, &t, "m-1", 9).unwrap();
    let got: Vec<_> = state
        .voices
        .iter()
        .map(|c| (c.voice.label(), c.participant_id.as_deref(), c.source))
        .collect();
    assert_eq!(
        got,
        [
            ('A', Some("p-mk"), NameSource::NameRound),
            ('B', Some("p-tb"), NameSource::NameRound)
        ]
    );
    assert_eq!(state.suggestions.len(), 1);
    assert!(state.suggestions[0].unsure);
    // A choice made before is not overwritten.
    let (m, t) = rig();
    choose_voice(&m, &t, "m-1", "A", None, 1).unwrap();
    let state = apply_name_round(&m, &t, "m-1", 2).unwrap();
    assert_eq!(state.voices[0].participant_id, None);
}

#[test]
fn every_choice_can_be_changed_back() {
    let (m, t) = rig();
    choose_voice(&m, &t, "m-1", "E", Some("p-jr"), 1).unwrap();
    let s = choose_voice(&m, &t, "m-1", "E", None, 2).unwrap();
    assert_eq!(s.voices.len(), 1);
    assert_eq!(s.voices[0].participant_id, None);
    let person = LineTarget::Person {
        participant_id: "p-ya".into(),
    };
    let s = choose_line(&m, &t, "m-1", 2, &person, 3).unwrap();
    assert_eq!(s.lines[0].participant_id.as_deref(), Some("p-ya"));
    let s = choose_line(&m, &t, "m-1", 2, &LineTarget::Nobody, 4).unwrap();
    assert_eq!(s.lines[0].participant_id, None);
    let s = choose_line(&m, &t, "m-1", 2, &LineTarget::Voice, 5).unwrap();
    assert!(s.lines.is_empty());
}

#[test]
fn commands_reject_malformed_labels_unknown_voices_participants_and_lines() {
    let (m, t) = rig();
    for bad in ["", "a", "AA", "Ä", "A ", "1", "<b>"] {
        assert_eq!(
            choose_voice(&m, &t, "m-1", bad, None, 1),
            Err(SpeakerError::InvalidVoice),
            "{bad:?}"
        );
    }
    assert_eq!(
        choose_voice(&m, &t, "m-1", "Q", None, 1),
        Err(SpeakerError::UnknownVoice)
    );
    assert_eq!(
        choose_voice(&m, &t, "m-1", "A", Some("p-zz"), 1),
        Err(SpeakerError::UnknownParticipant)
    );
    assert_eq!(
        choose_line(&m, &t, "m-1", 6, &LineTarget::Nobody, 1),
        Err(SpeakerError::UnknownLine)
    );
    assert_eq!(
        choose_line(&m, &t, "m-1", u64::MAX, &LineTarget::Voice, 1),
        Err(SpeakerError::UnknownLine)
    );
    let ghost = LineTarget::Person {
        participant_id: "../x".into(),
    };
    assert_eq!(
        choose_line(&m, &t, "m-1", 0, &ghost, 1),
        Err(SpeakerError::UnknownParticipant)
    );
    assert_eq!(speaker_state(&m, &t, "m-9"), Err(SpeakerError::NoMeeting));
    // Nothing was stored by any refused command.
    assert_eq!(m.load("m-1").unwrap().unwrap().speakers, None);
    assert_eq!(
        serde_json::to_value(SpeakerError::InvalidName { code: "tooLong" }).unwrap(),
        serde_json::json!({ "kind": "invalidName", "code": "tooLong" })
    );
}

#[test]
fn a_guest_is_a_participant_with_a_trimmed_name_of_1_to_80_characters() {
    let (m, t) = rig();
    let added = add_guest(&m, &t, "m-1", "  <b>Petra</b> Sand  ", 1).unwrap();
    assert_eq!(added.participant_id, "guest-1");
    let guest = added.state.participants.last().unwrap();
    assert_eq!(guest.name, "<b>Petra</b> Sand");
    assert!(guest.guest);
    let s = choose_voice(&m, &t, "m-1", "E", Some("guest-1"), 2).unwrap();
    assert_eq!(s.voices[0].participant_id.as_deref(), Some("guest-1"));
    assert_eq!(
        add_guest(&m, &t, "m-1", "   ", 3),
        Err(SpeakerError::InvalidName { code: "empty" })
    );
    assert_eq!(
        add_guest(&m, &t, "m-1", &"ö".repeat(81), 3),
        Err(SpeakerError::InvalidName { code: "tooLong" })
    );
    assert!(add_guest(&m, &t, "m-1", &"ö".repeat(80), 3).is_ok());
    assert_eq!(
        add_guest(&m, &t, "m-1", "mara klein", 3),
        Err(SpeakerError::InvalidName { code: "duplicate" })
    );
    assert_eq!(
        add_guest(&m, &t, "m-1", "Second Guest", 4)
            .unwrap()
            .participant_id,
        "guest-3"
    );
}

/// AC5: assigning, overriding and unassigning never touch the transcript file; the choices are in
/// the meeting file and survive a reload.
#[test]
fn the_transcript_file_is_byte_identical_and_choices_survive_a_reload() {
    crate::log::capture();
    let dir = tempfile::tempdir().unwrap();
    let keys = MemoryKeyProvider::with_key(DataKey::generate());
    let meetings = FileMeetingStore::open(dir.path(), &keys).unwrap();
    meetings.save(&meeting()).unwrap();
    let transcripts = meetings.transcripts();
    let mut w = transcripts.writer("m-1").unwrap();
    for s in transcript() {
        w.append(&s).unwrap();
    }
    drop(w);
    let path = dir.path().join("m-1.transcript");
    let before = std::fs::read(&path).unwrap();

    apply_name_round(&meetings, &transcripts, "m-1", 1).unwrap();
    choose_voice(&meetings, &transcripts, "m-1", "D", Some("p-ya"), 2).unwrap();
    let guest = add_guest(&meetings, &transcripts, "m-1", "Petra Sand", 3).unwrap();
    choose_voice(
        &meetings,
        &transcripts,
        "m-1",
        "E",
        Some(&guest.participant_id),
        4,
    )
    .unwrap();
    let to = |id: &str| LineTarget::Person {
        participant_id: id.into(),
    };
    choose_line(&meetings, &transcripts, "m-1", 3, &to("p-jr"), 5).unwrap();
    choose_line(&meetings, &transcripts, "m-1", 5, &to("p-tb"), 6).unwrap();
    choose_voice(&meetings, &transcripts, "m-1", "B", None, 7).unwrap();
    choose_line(&meetings, &transcripts, "m-1", 5, &LineTarget::Voice, 8).unwrap();
    let _ = choose_voice(&meetings, &transcripts, "m-1", "A", Some("nope"), 9);
    let _ = add_guest(&meetings, &transcripts, "m-1", "Mara Klein", 10);

    assert_eq!(std::fs::read(&path).unwrap(), before);
    // Reopened from disk.
    let reopened = FileMeetingStore::open(dir.path(), &keys).unwrap();
    let state = speaker_state(&reopened, &reopened.transcripts(), "m-1").unwrap();
    let voices: Vec<_> = state
        .voices
        .iter()
        .map(|c| (c.voice.label(), c.participant_id.clone()))
        .collect();
    assert_eq!(
        voices,
        [
            ('A', Some("p-mk".into())),
            ('B', None),
            ('D', Some("p-ya".into())),
            ('E', Some("guest-1".into()))
        ]
    );
    assert_eq!(
        state.lines,
        [LineChoice {
            seq: 3,
            participant_id: Some("p-jr".into())
        }]
    );
    // The meeting file holds no name in plain text, and no log line names anyone.
    let raw = std::fs::read(dir.path().join("m-1.meeting")).unwrap();
    for name in ["Petra", "Mara", "Yusuf"] {
        assert!(!raw.windows(name.len()).any(|w| w == name.as_bytes()));
    }
    for line in crate::log::take_captured() {
        for name in ["Petra", "Mara", "Klein", "Yusuf", "district"] {
            assert!(!line.contains(name), "{line}");
        }
    }
}
