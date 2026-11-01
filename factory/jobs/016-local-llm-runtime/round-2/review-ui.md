VERDICT: PASS

## Findings
- [note] LanguageModelSection.tsx:665 — the model file name is shown raw in the error body. A very long name could wrap awkwardly at 375 px. Non-blocking, since Notice wraps text.

## Checked
- Diff of LanguageModelSection.tsx and en.json. The change enables the "On this device" option, removes the unavailable hint, and adds one error Notice that reuses the shared Notice component and tone="error".
- The error message names the problem and gives a fix ("Choose another GGUF file").

## Not judged
Not rendered. The change is a few lines of text and conditional logic on existing components, and I did not take screenshots or measure layout at 375 px.
