# @monkeysee/bridge

## 0.1.0

### Minor Changes

- d37a190: M0: content-script MVP. Adds the wire protocol (`@monkeysee/protocol`) and the MCP
  bridge (`@monkeysee/bridge`) that exposes browser observation and actions as MCP
  tools over a local WebSocket to the MonkeySee Chrome extension.
- f7d84ed: M2: same-origin frames + visual fallback. The extension now indexes the top frame plus
  every same-origin child frame (`all_frames: true`), namespacing handle indices by frame
  (`frameId * FRAME_STRIDE + localId`) and reporting top-viewport coordinates so iframe
  elements are clickable by index and place correctly. Adds a `screenshot` MCP tool
  (`captureVisibleTab` PNG) and `get_state({ withScreenshot: true })`, which overlays
  numbered set-of-marks at element boxes (scaled by `dpr`) and returns them as an MCP image
  block. Protocol exports `FRAME_STRIDE`, `ScreenshotParams`, and an optional
  `PageState.screenshot`. Cross-origin iframes remain out of scope.
- 3ec00ad: Multi-tab control. Every observation/action/navigation tool now accepts an optional `tabId`
  to target a specific tab without changing which tab is controlled; the target rides on the
  `RpcRequest` envelope (the bridge splits it off the tool args, the SW router resolves it via
  `pickTab`/`resolveTab`). Adds three MCP tools: `list_tabs` (returns `{ tabId, url, title,
active, controlled }` per tab plus the current `controlledTabId`), `switch_tab(tabId)` (sets
  the controlled tab and brings it to the front), and `close_tab(tabId)` (closing the
  controlled tab releases control back to the active tab). `open_tab` still sets the controlled
  tab. Protocol exports `ListTabsParams`, `SwitchTabParams`, `CloseTabParams` and adds
  `list_tabs`/`switch_tab`/`close_tab` to `RpcMethod`.
- fcc2026: Enforce protocol compatibility on connect. The bridge now compares the extension's
  `protocolVersion` (sent in the `hello` handshake) against its own and refuses any mismatched
  **major** — it sends a `BridgeEvent` `{ type: 'incompatible', … }`, drops the socket, and
  never serves RPCs across the gap. The extension surfaces the refusal in the popup and retries
  slowly (30s) instead of reconnect-storming. Protocol adds `isProtocolCompatible` and the
  `BridgeEvent` type. Pre-1.0 both sides are major 0, so this only bites across a future
  breaking bump.

### Patch Changes

- Updated dependencies [d37a190]
- Updated dependencies [f7d84ed]
- Updated dependencies [3ec00ad]
- Updated dependencies [fcc2026]
  - @monkeysee/protocol@0.1.0
