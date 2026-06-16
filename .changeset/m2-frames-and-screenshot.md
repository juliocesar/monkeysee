---
'@monkeysee/protocol': minor
'@monkeysee/bridge': minor
'extension': minor
---

M2: same-origin frames + visual fallback. The extension now indexes the top frame plus
every same-origin child frame (`all_frames: true`), namespacing handle indices by frame
(`frameId * FRAME_STRIDE + localId`) and reporting top-viewport coordinates so iframe
elements are clickable by index and place correctly. Adds a `screenshot` MCP tool
(`captureVisibleTab` PNG) and `get_state({ withScreenshot: true })`, which overlays
numbered set-of-marks at element boxes (scaled by `dpr`) and returns them as an MCP image
block. Protocol exports `FRAME_STRIDE`, `ScreenshotParams`, and an optional
`PageState.screenshot`. Cross-origin iframes remain out of scope.
