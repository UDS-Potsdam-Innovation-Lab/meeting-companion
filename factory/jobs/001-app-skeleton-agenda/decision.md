ESCALATE
CI has never run for 954a8c5, so AC1's 3-OS pass can't be checked, and the job adds on-device storage of personal data (participant names, unencrypted), which the profile says must go to a human.

## Checks
- Tests: no `round-*/ci.md` exists (profile `ci_workflow: none`, branch not pushed), so there is no CI result for HEAD 954a8c53d21175503c50e1baaa2d1ba908dc6ecd. build.md reports these local results: `npm test` → Vitest 53/0, cargo 27/0, Playwright 8/0; `npm run lint`, `tauri build --no-bundle` and `scripts/smoke.mjs` pass on Linux only. I did not re-run the suite.
- Acceptance criteria:
  - AC1 ✗ not verified. `src/config.test.ts` "AC1 CI workflow" checks the shape of ci.yml (push/PR triggers, 3-OS matrix, lint/test/build/smoke steps). The AC also requires that "all jobs pass" on ubuntu, macOS and Windows, and that has never been observed.
  - AC2 ✓ `MeetingCard.test.tsx` covers each rejection, not-saved and the XSS literal; also `model.test.ts` AC2 and the Rust `model::tests`.
  - AC3 ✓ `AgendaList.test.tsx` AC3 (add/edit/move/remove, keyboard move, lead options = participants, lead cleared, 01/02 numbering) and `model.test.ts` AC3.
  - AC4 ✓ `model.test.ts` and `AgendaList.test.tsx` cover under, exact and over, with the over case shown in text plus the overrun class.
  - AC5 ✓ Rust `store::file::tests` (temp+rename, reopen latest, corrupt file left untouched, failed write keeps the old version), `App.test.tsx` AC5, `e2e` restart and no-network tests, `config.test.ts` (no HTTP plugin, CSP connect-src = IPC only).
  - AC6 ✓ `i18n.test.tsx` (key parity, key-mode render fails on literal text), `App.test.tsx` AC6 (de default, switch without reload, choice remembered).
  - AC7 ✓ `e2e/agenda-setup.spec.ts` (axe WCAG 2.2 AA at 1280×800, no horizontal scroll, targets ≥ 24 px, Tab order with focus ring, keyboard move and edit).
- Scope / factory files untouched: ✓ No paths under `.claude/` or `factory/` in `git diff main...HEAD`. The diff stays within the spec: skeleton, frame 01 manual builder, store, i18n, CI, screenshot command, and the AGENTS.md stack section. Out-of-scope frame elements are left out.
- Dependencies: runtime deps are tauri, serde, serde_json, react, react-dom, @tauri-apps/api, plus `@fontsource-variable/inter`. The spec doesn't name the font package; it bundles Inter locally so no font CDN is used. Dev tooling is in line with the stack: Vitest 5 instead of the then-current 3 (to fix an npm audit finding), `yaml`, `tempfile`, ESLint plugins. Rust is pinned to 1.99.1, which meets 1.85+.
- Reviews round 1: security, ux, ui and code all PASS, with notes only.

## For the human (ESCALATE only)
1. **Storage of personal data (profile approver rule: "Escalate anything that changes what is recorded, stored, or sent off the device").** From now on the app stores meeting title, date and time slot, participant names and the agenda as plain JSON, one file per meeting, in the OS app-data directory (`<app_data>/meetings/<id>.json`). There is no encryption and no deletion; both are deferred by the spec (encryption to job 3, deletion and archive to a later job). The security reviewer flagged this as a human decision. Decide: is unencrypted local storage of participant names acceptable until job 3, or must agenda files be encrypted at rest as well?
2. **AC1 is unverified.** The CI workflow has never run, because the branch isn't pushed and the profile still has `ci_workflow: none`. The Windows/macOS smoke run and the rename-over-existing path in the store have only been tested on Linux. Decide whether to push the branch and approve only after a green 3-OS run (recommended), or accept the local Linux evidence and merge.
3. **Minor, confirm or reject:** the unnamed runtime dependency `@fontsource-variable/inter`, and Vitest 5 instead of the version the stack implied.
4. **After merge (orchestrator or you):** in `factory/profile.md`, set `ci_workflow: ci.yml`, narrow `ui_paths` to `src/**`, and set the reviewer-ui screenshot command to `npm run screenshot`.
