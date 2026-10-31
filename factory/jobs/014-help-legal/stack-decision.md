AMENDED
Stack: EXISTING (unchanged).

## Spec review 1 (orchestrator, applying the facilitator's 2026-10-31 decisions: "consider all legal stuff agreed")
- No split: build help and legal notes together.
- Each later job adds its own paragraph to Legal notes: 010-voice-profiles adds "Privacy: voice profiles", 011-language-model-engine adds "Privacy: language model / Claude". This job must provide stable section ids for them (incl. `privacy-voice-profiles`, `privacy-language-model`) and may show nothing for those sections until the jobs land.
- Organisation details come from the IT-deployed `<app_data>/organisation.json` as specced; 010's controller line reads it from there.
- Licence list generated from the lockfiles by a script, as suggested.
