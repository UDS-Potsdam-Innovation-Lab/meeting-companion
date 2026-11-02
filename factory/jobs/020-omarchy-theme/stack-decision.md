AMENDED

## Spec review 1 (human, 2026-11-02) — overrides spec.md where they differ

1. Colours only. Under Omarchy the app takes the theme's colours and light/dark, but keeps its own font (Inter). No `--font-ui` token, no monospace switch; drop the font parts of the ACs (AC7 keeps only the layout check under the Omarchy palette).
2. The existing "System" theme setting follows Omarchy when an Omarchy theme is found; "Light" and "Dark" keep the app's own design. No new setting, no schema change.
3. Orchestrator defaults for the remaining open questions: poll once a second (no watcher crate); no pre-4.x fallback path; if 018 merges first, give its new colour tokens values in the mapping (merge main in, the token-list test covers it).
