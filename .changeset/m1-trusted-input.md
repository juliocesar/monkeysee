---
'extension': minor
---

M1: trusted input via `chrome.debugger`. Adds a CDP-based backend (`Input.dispatch*`)
for `click`, `type`, `type_text`, `press`, `click_at`, and `drag`, so events are trusted
(`isTrusted: true`) and pass checks that reject synthetic events — e.g. pressing Enter to
submit a search box. Toggle it in the popup ("Trusted input"); off by default, falling
back to the synthetic content-script backend. The MCP tool surface is unchanged.
