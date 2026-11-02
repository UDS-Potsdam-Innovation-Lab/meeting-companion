Omarchy theme compatibility: on Omarchy (Linux), the app follows the active Omarchy theme (colours, fonts, light/dark) and switches live when the theme changes; falls back to the default design tokens elsewhere

Note (orchestrator): job 018-captures is being built in parallel and touches src/styles.css and the live view; keep this job to the token layer and the theme source so the two merge cleanly.
