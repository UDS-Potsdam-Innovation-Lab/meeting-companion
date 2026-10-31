AMENDED
Stack: configured stack (Rust, Tauri 2, React). The phone web view and its crates (axum 0.8, qrcodegen) move to job 012-phone-web-view; this job depends on 012 and adds no server code of its own.

## Spec review 1 (human)
Facilitator, 2026-10-31: "split in two … consider all legal stuff agreed, but add a help and legal note area in the app".
- Split: (a) 012-phone-web-view = AC2 and the closed phone page plus the stack addition; (b) this job = voice profiles (AC1, AC3–AC7) on top of 012. Remove AC2 and the server work from this spec; reference 012's API instead.
- Legal check (GDPR Art. 9): treated as done and agreed. Use the spec's assumptions as decided: consent on the person's own phone is sufficient; the organisation operating the device is the controller; 12 months retention without use; the consent text is the spec's draft (de/en), shown and stored in the app; an admin setting that allows voice profiles on a device (default off) is IN scope; plain HTTP on the local network is accepted (no audio/voice data crosses it); claim-abuse safeguard = room-visible notice with Undo; anyone at the device may delete any profile.
- The consent text and privacy information must also appear in the Help and legal notes area (job 014-help-legal).
