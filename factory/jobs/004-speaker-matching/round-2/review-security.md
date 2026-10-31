VERDICT: PASS

## Findings
- [note] Round 2 (`5946255..dc9ab54`) changes only the UI: placement of the "Who said this?" picker (LineSpeaker.tsx `placePicker`, `position: fixed`), 44 px touch targets (styles.css), the live-view `role="alert"` banner for a failed choice (TranscriptPanel.tsx:61-65), the "Nothing to apply" hint (SpeakersView.tsx, i18n keys), and tests. It adds no new security surface: no new core commands, IPC, storage, logging, dependencies, CI or capability changes. Transcript and participant text still render as React text nodes. There is no `innerHTML`, `dangerouslySetInnerHTML` or `eval` in `src/features/speakers` or `src/features/transcript`.
- [note] The round-1 security notes still apply unchanged, and none of them block: the `SHERPA_ONNX_LIB_DIR` deviation needs human acceptance, `verifyLibs` checks only the SOURCE marker, `actions/cache@v4` is pinned by tag, the ONNX parser allocation is bounded, and embeddings are not zeroized. This round does not touch any of these areas.

## Checked
- `git diff 5946255..HEAD` in the worktree. That is round-1 head to round-2 head: src/, e2e/ and factory files only. `package.json`, `package-lock.json`, `src-tauri/` and `.github/` are unchanged.
- The new error banner shows only the fixed i18n string `speakers.failed`, with no error details. The picker reads only `getBoundingClientRect`/`scrollHeight`, and it removes its window listeners on cleanup.
- Secret scan: `gitleaks.sh` found no leaks (74 commits plus the working tree).
- The whole-job review is in round-1/review-security.md (PASS). I re-confirmed the parts this round could have affected.

## Secure-coding checklist
No `docs.secure_coding` in the profile. The rows below are the focus list plus the NFR sections assigned to this lens (Architecture, Privacy, Security).

| Rule | Result | Evidence |
|---|---|---|
| Input validation, injection (shell, SQL, path, HTML), unsafe deserialization | ok | Round 2 adds no new inputs. Picker text is still rendered as React text. Core-side validation is unchanged (speakers/mod.rs, see round 1). |
| Secrets in code, config, logs or fixtures; overly broad permissions | ok | gitleaks found no leaks. Capability and tauri config are unchanged. The e2e guest name "Petra Sand" is synthetic. |
| AuthN/AuthZ, sessions, insecure defaults, rate/size limits | n/a | No network or auth surface. The guest form still uses the core's 1–80 char limit. |
| Cryptography: established algorithms only | n/a | No crypto changes. |
| Errors and logs: no internals to users, no sensitive data in logs | ok | TranscriptPanel.tsx:61-65 shows the fixed `speakers.failed` text, with no error details. No log lines were added. |
| Personal data: minimisation, no real data in tests, role-based access, deletion | ok | Nothing new is stored. Test names are synthetic. |
| New dependencies: necessary, maintained, licensed, pinned; audit | n/a | No dependency or lockfile changes in round 2. |
| Security negative tests for what the change exposes | n/a | Round 2 exposes nothing new. The negative tests from round 1 remain. |
| Secret scan (`secret_scan: true`) | ok | `gitleaks.sh` found no leaks. |
| NFR Architecture: engines behind interfaces | n/a | No engine code touched. |
| NFR Privacy: stored only on device, encrypted at rest | n/a | Storage paths are unchanged. |
| NFR Privacy: voice profiles only on opt-in | n/a | Not touched. No profile or toggle was added. |
| NFR Privacy: nothing leaves the device | ok | No network, HTTP or plugin code added in round 2. |
| NFR Privacy: secrets in OS keychain | n/a | No secrets. |
| NFR Security: no listening ports | n/a | Not touched. |
| NFR Security: transcript text is untrusted input | ok | Transcript text still renders as React text nodes. There are no HTML sinks in the changed components. |
