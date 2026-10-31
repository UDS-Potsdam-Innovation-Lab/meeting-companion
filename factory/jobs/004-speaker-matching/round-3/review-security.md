VERDICT: PASS

## Findings
- [note] src-tauri/src/settings/mod.rs:229-240. The new `speakerModel` setting is accepted from the UI only if it passes `valid_text` and is in the core's own scan (`Catalog::speaker_models`, lib.rs:100-106). A value read back from the stored settings file is not checked against the scan (settings/mod.rs:117), but that is safe: the recorder resolves it through `models::choose_speaker` (engines/mod.rs:120, models.rs:455-461). That function returns only scanned models and falls back to the preferred one for an unknown id. An arbitrary path therefore never reaches `SpeakerEmbeddingExtractor`. Tests: `settings/tests.rs::the_speaker_model_is_accepted_only_from_the_scan_and_can_go_back_to_preferred` (`/etc/passwd`, a speech model id, empty, NUL) and the existing `choose_speaker(…"/etc/passwd")` test.
- [note] .github/workflows/ci.yml:26-36, 110-119. The two disk-cleanup steps only delete runner toolchains and build output. The sherpa-onnx pin, `fetch`, verify and the corrupted-archive step are unchanged. The end step removes the unpacked `src-tauri/native/lib`, so no derived library outlives the run, and every run re-verifies the cached archive. Neither step uses `continue-on-error` or `|| true`, and no secrets or permissions were added.
- [note] Merge of 006-settings-panel (218f04b). recording/mod.rs still drops embeddings and centroids on `stop` (:551-556) and on `Drop` (:610-616). The kept diarizer is now stored together with the model id it was loaded for, so a model change reloads it. The new and merged log lines are fixed strings or `DiarizeError`/`StoreError` Display impls, with no names, transcript text or paths.
- [note] The round-1 notes still apply unchanged and do not block: the `SHERPA_ONNX_LIB_DIR` deviation for the human gate, `verifyLibs` checking only the SOURCE marker, `actions/cache@v4` pinned by tag, and no zeroize of embeddings.

## Checked
- `git diff dc9ab54..HEAD` (round-2 head to round-3 head): the merge of main (006 settings) and e8dcc26 (speaker model in settings, CI disk cleanup). Since round 2, `Cargo.toml`/`Cargo.lock`, `package*.json`, `capabilities/` and `tauri.conf.json` are unchanged.
- The speaker-model path from UI to settings to `StartOptions` to `DiarizerProvider::load` to `choose_speaker` to `SherpaDiarizer::load`. The settings errors name the key only.
- The UI: the SettingsView Speaker model card renders folder paths and model names as React text. There is no `innerHTML`, `dangerouslySetInnerHTML` or `eval` anywhere under `src/` outside tests.
- Secret scan: `gitleaks.sh` found no leaks (86 commits plus the working tree).

## Secure-coding checklist
No `docs.secure_coding` in the profile. The rows below are the focus list plus the NFR sections assigned to this lens (Architecture, Privacy, Security).

| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection (shell, SQL, path, HTML), unsafe deserialization | ok | settings/mod.rs:229-240 accepts a model only from the scan. engines/mod.rs:120 `choose_speaker` stops path injection for stored values. The UI has no HTML sinks. |
| Secrets in code, config, logs or fixtures; overly broad permissions | ok | gitleaks found no leaks. The capability file and tauri config are unchanged. The CI `sudo rm` only touches the runner's own toolchains. |
| AuthN/AuthZ, sessions, insecure defaults, rate/size limits | ok | No network surface. `speakerModel` is limited by MAX_MODEL_ID, and the default is `None`, which means the preferred scanned model. |
| Cryptography: established algorithms only | n/a | No crypto changes. Settings use 006's existing encrypted store. |
| Errors and logs: no internals to users, no sensitive data in logs | ok | `SettingsError::Invalid{key}` carries the key only. The log lines use fixed strings or enum Display (diarize.rs:30-37). |
| Personal data: minimisation, no real data in tests, role-based access, deletion | ok | Embeddings and centroids are still dropped on stop and on drop (recording/mod.rs:551-556, 610-616). Test data is synthetic. |
| New dependencies: necessary, maintained, licensed, pinned; audit | n/a | No dependency changes since round 1. The round-1 assessment of sherpa-onnx =2.0.1 still holds. |
| Security negative tests for what the change exposes | ok | `the_speaker_model_is_accepted_only_from_the_scan_and_can_go_back_to_preferred` (path, foreign id, empty, NUL). The CI corrupted-archive step is still in place. |
| Secret scan (`secret_scan: true`) | ok | `gitleaks.sh` found no leaks. |
| NFR Architecture: engines behind interfaces | ok | The model choice goes through `DiarizerProvider::load(id)`. The UI sees only ids, names and sizes. |
| NFR Privacy: stored only on device, encrypted at rest | ok | The speaker model id is stored in 006's encrypted settings file. No audio or embedding is written. |
| NFR Privacy: voice profiles only on opt-in | ok | None are created. The voices tracker is per session only. |
| NFR Privacy: nothing leaves the device | ok | No runtime network code was added. The CI-only steps do not touch the app. |
| NFR Privacy: secrets in OS keychain | n/a | No new secrets. |
| NFR Security: no listening ports | ok | None added. The capability file and config are unchanged. |
| NFR Security: transcript text is untrusted input | ok | Unchanged since round 1. Text renders as React text nodes, and the name round only tokenises it. |
