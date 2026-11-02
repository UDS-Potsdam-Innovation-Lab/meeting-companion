use super::*;
use crate::crypto::MemoryKeyProvider;
use crate::model::tests::{free_running, running, sample};
use crate::model::{Participant, KIND_DECISION, KIND_QUESTION, KIND_TODO};
use crate::store::{FileMeetingStore, MemoryMeetingStore};

const NOW: u64 = 400_000;

fn people(m: &mut Meeting) {
    m.participants.push(Participant {
        id: "p-ya".into(),
        name: "Yusuf Aydin".into(),
        guest: false,
    });
}

/// A running agenda meeting (item i-2 current) with three participants, stored in `store`.
fn stored(store: &dyn MeetingStore) {
    let mut m = running();
    people(&mut m);
    store.save(&m).unwrap();
}

fn todo(text: &str) -> NewCapture {
    NewCapture {
        kind: KIND_TODO.into(),
        text: text.into(),
        owner: Some("p-ya".into()),
        due: Some("2026-11-06".into()),
        item_id: Some("i-2".into()),
        topic_id: None,
    }
}

fn decision(text: &str) -> NewCapture {
    NewCapture {
        kind: KIND_DECISION.into(),
        owner: None,
        due: None,
        ..todo(text)
    }
}

fn change(kind: &str, text: &str) -> CaptureChange {
    CaptureChange {
        kind: kind.into(),
        text: text.into(),
        owner: None,
        due: None,
    }
}

fn file_store(dir: &std::path::Path, keys: &MemoryKeyProvider) -> FileMeetingStore {
    FileMeetingStore::open(dir, keys).unwrap()
}

fn fields(r: Result<CaptureSaved, CaptureError>) -> Vec<(String, &'static str)> {
    match r {
        Err(CaptureError::Invalid { fields }) => {
            fields.into_iter().map(|f| (f.field, f.code)).collect()
        }
        other => panic!("expected Invalid, got {other:?}"),
    }
}

// ---- AC1: saved durably ------------------------------------------------------------------------

#[test]
fn a_typed_capture_is_in_the_sealed_file_after_a_reload() {
    let dir = tempfile::tempdir().unwrap();
    let keys = MemoryKeyProvider::new();
    {
        let store = file_store(dir.path(), &keys);
        stored(&store);
        let saved = add_capture(
            &store,
            "m-1",
            todo("  Dritter Pilotschule schreiben  "),
            NOW,
        )
        .unwrap();
        assert_eq!(saved.captures, vec![saved.capture.clone()]);
        assert!(saved.capture.id.starts_with("c-"));
    }
    // A new store on the same folder and key: what an app restart reads.
    let store = file_store(dir.path(), &keys);
    let m = store.load("m-1").unwrap().unwrap();
    assert_eq!(m.captures.len(), 1);
    let c = &m.captures[0];
    assert_eq!(c.kind, "todo");
    assert_eq!(c.text, "Dritter Pilotschule schreiben");
    assert_eq!(c.owner.as_deref(), Some("p-ya"));
    assert_eq!(c.due.as_deref(), Some("2026-11-06"));
    assert_eq!(c.item_id.as_deref(), Some("i-2"));
    assert_eq!(c.topic_id, None);
    assert_eq!(c.source, "typed");
    assert_eq!(c.created_at, NOW);
    assert_eq!(c.edited_at, None);
    // Sealed: the text is not readable in the file.
    let bytes = std::fs::read(dir.path().join("m-1.meeting")).unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("Pilotschule"));
}

#[test]
fn a_free_meeting_captures_to_the_current_topic_or_to_no_topic() {
    let store = MemoryMeetingStore::new();
    store.save(&free_running()).unwrap();
    let to_topic = NewCapture {
        item_id: None,
        topic_id: Some("t-2".into()),
        ..decision("Erste Runde remote")
    };
    let a = add_capture(&store, "m-1", to_topic, NOW).unwrap().capture;
    assert_eq!(a.topic_id.as_deref(), Some("t-2"));
    let no_topic = NewCapture {
        item_id: None,
        topic_id: None,
        ..decision("Offline-Modus kommt nach der Beta")
    };
    let b = add_capture(&store, "m-1", no_topic, NOW + 1)
        .unwrap()
        .capture;
    assert_eq!((b.item_id, b.topic_id), (None, None));
    assert_eq!(store.load("m-1").unwrap().unwrap().captures.len(), 2);
}

#[test]
fn every_new_capture_gets_its_own_id() {
    let store = MemoryMeetingStore::new();
    stored(&store);
    let ids: std::collections::HashSet<String> = (0..20)
        .map(|i| {
            add_capture(&store, "m-1", decision(&format!("D {i}")), NOW + i)
                .unwrap()
                .capture
                .id
        })
        .collect();
    assert_eq!(ids.len(), 20);
}

#[test]
fn a_save_from_the_ui_keeps_the_stored_captures() {
    let store = MemoryMeetingStore::new();
    stored(&store);
    let ui_copy = store.load("m-1").unwrap().unwrap();
    add_capture(&store, "m-1", decision("Beta startet am 14."), NOW).unwrap();
    // The UI's copy has no captures, or forges one.
    crate::save(&store, ui_copy.clone(), NOW + 1).unwrap();
    let mut forged = ui_copy;
    forged.captures = vec![Capture {
        id: "c-forged".into(),
        kind: KIND_QUESTION.into(),
        text: "forged".into(),
        owner: None,
        due: None,
        item_id: None,
        topic_id: None,
        source: "typed".into(),
        segments: vec![],
        created_at: 1,
        edited_at: None,
    }];
    crate::save(&store, forged, NOW + 2).unwrap();
    let after = store.load("m-1").unwrap().unwrap();
    assert_eq!(after.captures.len(), 1);
    assert_eq!(after.captures[0].text, "Beta startet am 14.");
}

#[test]
fn a_meeting_file_written_before_this_job_still_loads() {
    // Written by an earlier version: no `captures`.
    let json = serde_json::to_value(running()).unwrap();
    assert!(json.get("captures").is_none());
    let dir = tempfile::tempdir().unwrap();
    let keys = MemoryKeyProvider::new();
    let store = file_store(dir.path(), &keys);
    let m: Meeting = serde_json::from_value(json).unwrap();
    store.save(&m).unwrap();
    let back = file_store(dir.path(), &keys).load("m-1").unwrap().unwrap();
    assert!(back.captures.is_empty());
    assert_eq!(load_captures(&store, "m-1").unwrap(), vec![]);
}

// ---- AC2: the core validates every capture ---------------------------------------------------

#[test]
fn bad_text_is_refused_and_nothing_is_stored() {
    let store = MemoryMeetingStore::new();
    stored(&store);
    let before = store.load("m-1").unwrap();
    for text in ["", "   ", "\n\t "] {
        assert_eq!(
            fields(add_capture(&store, "m-1", decision(text), NOW)),
            [("text".into(), "empty")]
        );
    }
    let long = "ä".repeat(501);
    assert_eq!(
        fields(add_capture(&store, "m-1", decision(&long), NOW)),
        [("text".into(), "tooLong")]
    );
    assert_eq!(store.load("m-1").unwrap(), before);
    // 500 characters after trimming are fine.
    let ok = format!("  {}  ", "ä".repeat(500));
    assert!(add_capture(&store, "m-1", decision(&ok), NOW).is_ok());
}

#[test]
fn an_unknown_kind_is_refused() {
    let store = MemoryMeetingStore::new();
    stored(&store);
    for kind in ["", "Decision", "note", "<script>"] {
        let input = NewCapture {
            kind: kind.into(),
            ..decision("x")
        };
        assert_eq!(
            fields(add_capture(&store, "m-1", input, NOW)),
            [("kind".into(), "unknown")],
            "{kind}"
        );
    }
    assert!(load_captures(&store, "m-1").unwrap().is_empty());
}

#[test]
fn the_owner_must_be_a_participant_and_only_on_a_todo() {
    let store = MemoryMeetingStore::new();
    stored(&store);
    let stranger = NewCapture {
        owner: Some("p-9".into()),
        ..todo("x")
    };
    assert_eq!(
        fields(add_capture(&store, "m-1", stranger, NOW)),
        [("owner".into(), "notParticipant")]
    );
    for kind in [KIND_DECISION, KIND_QUESTION] {
        let input = NewCapture {
            kind: kind.into(),
            due: None,
            ..todo("x")
        };
        assert_eq!(
            fields(add_capture(&store, "m-1", input, NOW)),
            [("owner".into(), "notTodo")]
        );
    }
    // A to-do without owner or date is fine.
    let bare = NewCapture {
        owner: None,
        due: None,
        ..todo("x")
    };
    assert!(add_capture(&store, "m-1", bare, NOW).is_ok());
}

#[test]
fn an_invalid_due_date_is_refused() {
    let store = MemoryMeetingStore::new();
    stored(&store);
    for due in ["2026-02-30", "6.11.2026", "tomorrow", "2026-1-01"] {
        let input = NewCapture {
            due: Some(due.into()),
            ..todo("x")
        };
        assert_eq!(
            fields(add_capture(&store, "m-1", input, NOW)),
            [("due".into(), "invalid")],
            "{due}"
        );
    }
    assert!(load_captures(&store, "m-1").unwrap().is_empty());
}

#[test]
fn an_unknown_item_or_topic_is_refused() {
    let store = MemoryMeetingStore::new();
    stored(&store);
    let input = NewCapture {
        item_id: Some("i-9".into()),
        ..decision("x")
    };
    assert_eq!(
        fields(add_capture(&store, "m-1", input, NOW)),
        [("itemId".into(), "unknown")]
    );
    let topic_on_agenda = NewCapture {
        topic_id: Some("t-1".into()),
        ..decision("x")
    };
    assert_eq!(
        fields(add_capture(&store, "m-1", topic_on_agenda, NOW)),
        [("topicId".into(), "notInAgendaMode")]
    );

    let free = MemoryMeetingStore::new();
    free.save(&free_running()).unwrap();
    let unknown_topic = NewCapture {
        item_id: None,
        topic_id: Some("t-9".into()),
        ..decision("x")
    };
    assert_eq!(
        fields(add_capture(&free, "m-1", unknown_topic, NOW)),
        [("topicId".into(), "unknown")]
    );
    let item_on_free = decision("x");
    assert_eq!(
        fields(add_capture(&free, "m-1", item_on_free, NOW)),
        [("itemId".into(), "notInFreeMode")]
    );
}

#[test]
fn only_a_running_meeting_takes_captures() {
    let store = MemoryMeetingStore::new();
    store.save(&sample()).unwrap();
    assert_eq!(
        add_capture(&store, "m-1", decision("x"), NOW),
        Err(CaptureError::NotRunning)
    );
    let mut ended = running();
    let run = ended.run.as_mut().unwrap();
    run.items[1].ended_at = Some(NOW);
    run.ended_at = Some(NOW);
    store.save(&ended).unwrap();
    assert_eq!(
        add_capture(&store, "m-1", decision("x"), NOW),
        Err(CaptureError::NotRunning)
    );
    assert_eq!(
        add_capture(&store, "m-9", decision("x"), NOW),
        Err(CaptureError::NoMeeting)
    );
    assert!(load_captures(&store, "m-1").unwrap().is_empty());
}

#[test]
fn the_input_schema_is_closed() {
    let ok: Result<NewCapture, _> =
        serde_json::from_str(r#"{"kind":"todo","text":"x","owner":null,"itemId":"i-2"}"#);
    assert!(ok.is_ok());
    for bad in [
        r#"{"kind":"todo","text":"x","source":"suggested"}"#,
        r#"{"kind":"todo","text":"x","id":"c-1"}"#,
        r#"{"kind":"todo","text":"x","createdAt":1}"#,
        r#"{"kind":"todo"}"#,
    ] {
        assert!(serde_json::from_str::<NewCapture>(bad).is_err(), "{bad}");
    }
    assert!(
        serde_json::from_str::<CaptureChange>(r#"{"kind":"todo","text":"x","itemId":"i-1"}"#)
            .is_err()
    );
    assert!(serde_json::from_str::<Capture>(
        r#"{"id":"c-1","kind":"todo","text":"x","source":"typed","createdAt":1,"extra":1}"#
    )
    .is_err());
}

#[test]
fn a_locked_store_refuses_and_says_so() {
    assert_eq!(
        add_capture(&crate::store::LockedMeetingStore, "m-1", decision("x"), NOW),
        Err(CaptureError::Locked)
    );
}

// ---- AC3: edit, delete, undo -----------------------------------------------------------------

#[test]
fn an_edit_is_written_and_keeps_id_time_and_item() {
    let dir = tempfile::tempdir().unwrap();
    let keys = MemoryKeyProvider::new();
    let store = file_store(dir.path(), &keys);
    stored(&store);
    let original = add_capture(&store, "m-1", todo("Einladungen verschicken"), NOW)
        .unwrap()
        .capture;
    let edit = CaptureChange {
        owner: Some("p-1".into()),
        due: Some("2026-11-09".into()),
        ..change(KIND_TODO, " Einladungen neu verschicken ")
    };
    update_capture(&store, "m-1", &original.id, edit, NOW + 5_000).unwrap();
    let back = file_store(dir.path(), &keys).load("m-1").unwrap().unwrap();
    let c = &back.captures[0];
    assert_eq!(c.id, original.id);
    assert_eq!(c.created_at, NOW);
    assert_eq!(c.item_id.as_deref(), Some("i-2"));
    assert_eq!(c.text, "Einladungen neu verschicken");
    assert_eq!(c.owner.as_deref(), Some("p-1"));
    assert_eq!(c.due.as_deref(), Some("2026-11-09"));
    assert_eq!(c.edited_at, Some(NOW + 5_000));

    // Changing the kind drops owner and date in the UI; a decision with an owner is refused.
    let bad = CaptureChange {
        owner: Some("p-1".into()),
        ..change(KIND_DECISION, "x")
    };
    assert_eq!(
        fields(update_capture(&store, "m-1", &original.id, bad, NOW)),
        [("owner".into(), "notTodo")]
    );
    assert_eq!(
        update_capture(&store, "m-1", "c-nope", change(KIND_TODO, "x"), NOW),
        Err(CaptureError::UnknownCapture)
    );
    assert_eq!(
        file_store(dir.path(), &keys)
            .load("m-1")
            .unwrap()
            .unwrap()
            .captures,
        back.captures
    );
}

#[test]
fn delete_and_undo_restore_the_capture_with_its_original_id_time_and_item() {
    let dir = tempfile::tempdir().unwrap();
    let keys = MemoryKeyProvider::new();
    let store = file_store(dir.path(), &keys);
    let kept = UndoCopies::new();
    stored(&store);
    let first = add_capture(&store, "m-1", decision("Erste"), NOW)
        .unwrap()
        .capture;
    let second = add_capture(&store, "m-1", todo("Zweite"), NOW + 1_000)
        .unwrap()
        .capture;

    let deleted = delete_capture(&store, &kept, "m-1", &first.id, NOW + 2_000).unwrap();
    assert_eq!(deleted.capture, first);
    let reloaded = file_store(dir.path(), &keys).load("m-1").unwrap().unwrap();
    assert_eq!(reloaded.captures, vec![second.clone()]);

    let restored = restore_capture(&store, &kept, "m-1", &first.id, NOW + 3_000).unwrap();
    assert_eq!(restored.captures, vec![first.clone(), second.clone()]);
    let reloaded = file_store(dir.path(), &keys).load("m-1").unwrap().unwrap();
    assert_eq!(reloaded.captures, vec![first, second.clone()]);

    // Undo of a new capture is a delete of it.
    delete_capture(&store, &kept, "m-1", &second.id, NOW + 4_000).unwrap();
    assert_eq!(
        delete_capture(&store, &kept, "m-1", &second.id, NOW + 4_000),
        Err(CaptureError::UnknownCapture)
    );
    assert_eq!(
        file_store(dir.path(), &keys)
            .load("m-1")
            .unwrap()
            .unwrap()
            .captures
            .len(),
        1
    );
}

// ---- 019 AC1: Undo restores only what the core removed ------------------------------------------

/// A suggested, edited to-do with every field set: what a restore must bring back unchanged.
fn full_capture(store: &dyn MeetingStore) -> Capture {
    let c = add_suggested(
        store,
        "m-1",
        todo("Dritter Pilotschule schreiben"),
        vec![7, 9],
        NOW,
    )
    .unwrap()
    .capture;
    update_capture(
        store,
        "m-1",
        &c.id,
        change_todo("Dritter Pilotschule bis Freitag schreiben"),
        NOW + 500,
    )
    .unwrap()
    .capture
}

fn change_todo(text: &str) -> CaptureChange {
    CaptureChange {
        kind: KIND_TODO.into(),
        text: text.into(),
        owner: Some("p-ya".into()),
        due: Some("2026-11-06".into()),
    }
}

#[test]
fn restore_puts_back_exactly_the_copy_the_core_kept() {
    let dir = tempfile::tempdir().unwrap();
    let keys = MemoryKeyProvider::new();
    let store = file_store(dir.path(), &keys);
    let kept = UndoCopies::new();
    stored(&store);
    let c = full_capture(&store);
    assert_eq!(c.source, "suggested");
    assert_eq!(c.segments, vec![7, 9]);
    assert_eq!(c.edited_at, Some(NOW + 500));
    delete_capture(&store, &kept, "m-1", &c.id, NOW + 1_000).unwrap();
    assert!(kept.holds("m-1"));
    let back = restore_capture(&store, &kept, "m-1", &c.id, NOW + 2_000)
        .unwrap()
        .capture;
    // Every field: id, kind, text, owner, due, item, topic, source, segments, createdAt, editedAt.
    assert_eq!(back, c);
    let reloaded = file_store(dir.path(), &keys).load("m-1").unwrap().unwrap();
    assert_eq!(reloaded.captures, vec![c]);
    assert!(!kept.holds("m-1"));
}

#[test]
fn a_capture_that_was_never_removed_restores_nothing() {
    let store = MemoryMeetingStore::new();
    let kept = UndoCopies::new();
    stored(&store);
    let c = add_capture(&store, "m-1", decision("Beta am 14."), NOW)
        .unwrap()
        .capture;
    assert_eq!(
        fields(restore_capture(&store, &kept, "m-1", &c.id, NOW)),
        [("captureId".into(), "notRemoved")]
    );
    assert_eq!(
        fields(restore_capture(
            &store,
            &kept,
            "m-1",
            "c-0123456789abcdef",
            NOW
        )),
        [("captureId".into(), "notRemoved")]
    );
    assert_eq!(load_captures(&store, "m-1").unwrap(), vec![c]);
}

#[test]
fn a_second_restore_of_the_same_capture_restores_nothing() {
    let store = MemoryMeetingStore::new();
    let kept = UndoCopies::new();
    stored(&store);
    let c = add_capture(&store, "m-1", decision("x"), NOW)
        .unwrap()
        .capture;
    delete_capture(&store, &kept, "m-1", &c.id, NOW).unwrap();
    restore_capture(&store, &kept, "m-1", &c.id, NOW).unwrap();
    assert_eq!(
        fields(restore_capture(&store, &kept, "m-1", &c.id, NOW)),
        [("captureId".into(), "notRemoved")]
    );
    assert_eq!(load_captures(&store, "m-1").unwrap(), vec![c]);
}

#[test]
fn a_capture_replaced_as_the_kept_copy_by_a_later_delete_restores_nothing() {
    let store = MemoryMeetingStore::new();
    let kept = UndoCopies::new();
    stored(&store);
    let a = add_capture(&store, "m-1", decision("A"), NOW)
        .unwrap()
        .capture;
    let b = add_capture(&store, "m-1", decision("B"), NOW + 1)
        .unwrap()
        .capture;
    delete_capture(&store, &kept, "m-1", &a.id, NOW + 2).unwrap();
    delete_capture(&store, &kept, "m-1", &b.id, NOW + 3).unwrap();
    assert_eq!(
        fields(restore_capture(&store, &kept, "m-1", &a.id, NOW + 4)),
        [("captureId".into(), "notRemoved")]
    );
    assert!(load_captures(&store, "m-1").unwrap().is_empty());
    // The later one is still kept.
    restore_capture(&store, &kept, "m-1", &b.id, NOW + 5).unwrap();
    assert_eq!(load_captures(&store, "m-1").unwrap(), vec![b]);
}

#[test]
fn a_meeting_that_is_not_running_restores_nothing() {
    let store = MemoryMeetingStore::new();
    let kept = UndoCopies::new();
    stored(&store);
    let c = add_capture(&store, "m-1", decision("x"), NOW)
        .unwrap()
        .capture;
    delete_capture(&store, &kept, "m-1", &c.id, NOW).unwrap();
    let mut ended = store.load("m-1").unwrap().unwrap();
    let run = ended.run.as_mut().unwrap();
    run.ended_at = Some(NOW + 1);
    run.items[1].ended_at = Some(NOW + 1);
    store.save(&ended).unwrap();
    assert_eq!(
        fields(restore_capture(&store, &kept, "m-1", &c.id, NOW + 2)),
        [("meetingId".into(), "notRunning")]
    );
    assert!(load_captures(&store, "m-1").unwrap().is_empty());
    // The copy is gone with the meeting's end.
    assert!(!kept.holds("m-1"));
}

#[test]
fn another_meetings_id_restores_nothing() {
    let store = MemoryMeetingStore::new();
    let kept = UndoCopies::new();
    stored(&store);
    let mut other = running();
    other.id = "m-2".into();
    people(&mut other);
    store.save(&other).unwrap();
    let c = add_capture(&store, "m-1", decision("x"), NOW)
        .unwrap()
        .capture;
    delete_capture(&store, &kept, "m-1", &c.id, NOW).unwrap();
    assert_eq!(
        fields(restore_capture(&store, &kept, "m-2", &c.id, NOW)),
        [("captureId".into(), "notRemoved")]
    );
    assert!(load_captures(&store, "m-2").unwrap().is_empty());
    assert!(load_captures(&store, "m-1").unwrap().is_empty());
    // Still restorable in its own meeting.
    restore_capture(&store, &kept, "m-1", &c.id, NOW).unwrap();
    assert_eq!(load_captures(&store, "m-1").unwrap(), vec![c]);
}

#[test]
fn forgetting_a_meeting_drops_its_copy() {
    let store = MemoryMeetingStore::new();
    let kept = UndoCopies::new();
    stored(&store);
    let c = add_capture(&store, "m-1", decision("x"), NOW)
        .unwrap()
        .capture;
    delete_capture(&store, &kept, "m-1", &c.id, NOW).unwrap();
    kept.forget("m-1");
    assert_eq!(
        fields(restore_capture(&store, &kept, "m-1", &c.id, NOW)),
        [("captureId".into(), "notRemoved")]
    );
}

#[test]
fn the_restore_request_has_no_capture_body_and_refuses_one() {
    let ok: RestoreRequest =
        serde_json::from_value(serde_json::json!({ "meetingId": "m-1", "captureId": "c-1" }))
            .unwrap();
    assert_eq!(
        ok,
        RestoreRequest {
            meeting_id: "m-1".into(),
            capture_id: "c-1".into()
        }
    );
    for extra in [
        serde_json::json!({ "meetingId": "m-1", "captureId": "c-1", "capture": { "id": "c-1",
            "kind": "decision", "text": "forged", "source": "typed", "createdAt": 1 } }),
        serde_json::json!({ "meetingId": "m-1", "captureId": "c-1", "text": "forged" }),
        serde_json::json!({ "meetingId": "m-1", "captureId": "c-1", "source": "suggested" }),
    ] {
        assert!(serde_json::from_value::<RestoreRequest>(extra).is_err());
    }
}

#[test]
fn a_failed_restore_write_keeps_the_copy_for_another_try() {
    let store = MemoryMeetingStore::new();
    let kept = UndoCopies::new();
    stored(&store);
    let c = add_capture(&store, "m-1", decision("x"), NOW)
        .unwrap()
        .capture;
    delete_capture(&store, &kept, "m-1", &c.id, NOW).unwrap();
    let failing = FailingStore(MemoryMeetingStore::new());
    failing
        .0
        .save(&store.load("m-1").unwrap().unwrap())
        .unwrap();
    assert_eq!(
        restore_capture(&failing, &kept, "m-1", &c.id, NOW),
        Err(CaptureError::StorageFailed)
    );
    restore_capture(&store, &kept, "m-1", &c.id, NOW).unwrap();
    assert_eq!(load_captures(&store, "m-1").unwrap(), vec![c]);
}

#[test]
fn a_suggested_capture_is_checked_like_a_typed_one() {
    let store = MemoryMeetingStore::new();
    stored(&store);
    let padded = add_suggested(&store, "m-1", decision("  Beta am 14.  "), vec![3], NOW)
        .unwrap()
        .capture;
    assert_eq!(padded.text, "Beta am 14.");
    assert_eq!(padded.source, "suggested");
    assert_eq!(
        fields(add_suggested(&store, "m-1", decision(" "), vec![3], NOW)),
        [("text".into(), "empty")]
    );
    let owner_on_decision = NewCapture {
        owner: Some("p-ya".into()),
        ..decision("x")
    };
    assert_eq!(
        fields(add_suggested(
            &store,
            "m-1",
            owner_on_decision,
            vec![3],
            NOW
        )),
        [("owner".into(), "notTodo")]
    );
    assert_eq!(
        fields(add_suggested(&store, "m-1", decision("x"), vec![], NOW)),
        [("segments".into(), "empty")]
    );
    assert_eq!(load_captures(&store, "m-1").unwrap().len(), 1);
}

// ---- AC4: inert, never logged, no language model ----------------------------------------------

/// A store whose writes fail with an I/O error (a full disk).
struct FailingStore(MemoryMeetingStore);

impl MeetingStore for FailingStore {
    fn save(&self, _: &Meeting) -> Result<(), StoreError> {
        Err(StoreError::Io(std::io::Error::other("disk full")))
    }
    fn load(&self, id: &str) -> Result<Option<Meeting>, StoreError> {
        self.0.load(id)
    }
    fn latest(&self) -> Result<Option<Meeting>, StoreError> {
        self.0.latest()
    }
}

#[test]
fn capture_text_never_reaches_the_log_or_an_error() {
    const SECRET: &str = "Kündigung von Herrn Weber <script>alert(1)</script>";
    crate::log::capture();
    let store = MemoryMeetingStore::new();
    stored(&store);
    let c = add_capture(&store, "m-1", todo(SECRET), NOW)
        .unwrap()
        .capture;
    update_capture(&store, "m-1", &c.id, change(KIND_TODO, SECRET), NOW).unwrap();
    let errors = vec![
        add_capture(&store, "m-1", decision(&SECRET.repeat(20)), NOW).unwrap_err(),
        update_capture(&store, "m-1", "c-x", change(KIND_TODO, SECRET), NOW).unwrap_err(),
    ];
    let kept = UndoCopies::new();
    let deleted = delete_capture(&store, &kept, "m-1", &c.id, NOW)
        .unwrap()
        .capture;
    let failing = FailingStore(MemoryMeetingStore::new());
    stored(&failing.0);
    let errors = [
        errors,
        vec![
            add_capture(&failing, "m-1", todo(SECRET), NOW).unwrap_err(),
            restore_capture(&failing, &kept, "m-1", &deleted.id, NOW).unwrap_err(),
        ],
    ]
    .concat();
    let lines = crate::log::take_captured();
    assert!(
        lines
            .iter()
            .any(|l| l.contains("could not store a capture")),
        "the failed write is logged: {lines:?}"
    );
    for line in &lines {
        for word in ["Kündigung", "Weber", "script"] {
            assert!(!line.contains(word), "logged capture text: {line}");
        }
    }
    for e in &errors {
        let json = serde_json::to_string(e).unwrap();
        assert!(!json.contains("Weber"), "{json}");
        assert!(!format!("{e:?}").contains("Weber"));
    }
    assert_eq!(errors.last(), Some(&CaptureError::StorageFailed));
}

#[test]
fn markup_in_capture_text_is_stored_verbatim() {
    let store = MemoryMeetingStore::new();
    stored(&store);
    let text = "<img src=x onerror=alert(1)> & </div>";
    add_capture(&store, "m-1", decision(text), NOW).unwrap();
    assert_eq!(load_captures(&store, "m-1").unwrap()[0].text, text);
}

#[test]
fn capture_edit_and_delete_make_no_language_model_request() {
    use crate::engines::llm::ScriptedLanguageModel;
    // The engine the app would hold; capturing never reaches it.
    let engine = std::sync::Arc::new(ScriptedLanguageModel::default());
    let store = MemoryMeetingStore::new();
    stored(&store);
    let c = add_capture(&store, "m-1", todo("x"), NOW).unwrap().capture;
    update_capture(&store, "m-1", &c.id, change(KIND_QUESTION, "y"), NOW).unwrap();
    let kept = UndoCopies::new();
    let d = delete_capture(&store, &kept, "m-1", &c.id, NOW)
        .unwrap()
        .capture;
    restore_capture(&store, &kept, "m-1", &d.id, NOW).unwrap();
    assert!(engine.requests().is_empty());
    // And the capture code has no way to one: no engine, language model or network type in it.
    let source = include_str!("mod.rs");
    for word in [
        "engines::",
        "language_model",
        "LanguageModel",
        "Transport",
        "std::net",
    ] {
        assert!(!source.contains(word), "captures/mod.rs mentions {word}");
    }
}
