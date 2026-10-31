VERDICT: PASS

## Findings
- [note] src/features/speakers/useSpeakers.ts (`failed`) and src/features/live/LiveView.tsx — a failed per-line choice sets `failed`, but only SpeakersView shows the error banner. From the "Who said this?" picker in the live transcript the failure is silent, and the picker has already closed. Consider showing the same alert in the live view. Not blocking, because the core is local and failures are rare.
- [note] src/features/speakers/SpeakersView.tsx — the "Apply names to transcript" button uses aria-disabled and does nothing when there are no suggestions. It gives no hint why. Fine for now.

## Checked
- SpeakersView, LineSpeaker, GuestForm and useSpeakers: the no-model, empty, unsure and suggested states; labelled pickers; Escape and outside-click closing; focus return; guest name validation errors announced with role=alert and aria-describedby.
- Spec AC3, AC5 and AC7 against the code: copy comes from i18n keys, "unsure" is shown as text and not by colour alone, and the non-modal line picker matches the spec.
- I did not run the app, the e2e tests or axe. This is a code-level review only.
