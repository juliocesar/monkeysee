# monkeysee-bridge

## 0.5.0

### Minor Changes

- Add a progressive (cinematic) fill mode to `fill_fields`. A new `mode: 'batch' | 'progressive'` param (default `progressive`) plus `pace: 'fast' | 'normal' | 'slow'` make the fill human-watchable: smooth-scroll each field into view, typewriter text input, and open dropdowns to click the option. `mode: 'batch'` keeps the instant, no-animation fill for unattended/programmatic runs.

### Patch Changes

- Updated dependencies
  - monkeysee-protocol@0.3.0

## 0.4.0

### Minor Changes

- Add form discovery: `get_forms` and `fill_fields`.

  `get_forms` is a form-scoped sibling of `get_state` — it returns only the page's controls,
  grouped by `<form>` (plus orphans), each with the signal a form-filler needs (kind, type,
  label, name, autocomplete, current value, checked state, select/radio options, and
  required/disabled/readonly flags) and `interaction`/`requiresTrustedInput` hints. Geometry is
  omitted unless `includeBoxes:true`. It covers native controls, ARIA-role widgets, and open
  shadow DOM; radio groups collapse to one field whose options carry clickable indices. On a
  form buried in a noisy page it is ~95% smaller than `get_state`. It is read-only and ungated,
  and its indices drive the existing `type`/`click`/`select_option`/`focus` tools.

  `fill_fields` batches many field writes into a single MCP call; `checked` is idempotent.

  Protocol additions: `FormsState`/`FormField`/`FormGroup`/`FormOption` types, the
  `FORM_INDEX_BASE` index-partition constant, the `get_forms` RPC method, and the
  `GetFormsParams`/`FillFieldsParams` schemas.

### Patch Changes

- Updated dependencies
  - monkeysee-protocol@0.2.0

## 0.3.0

### Minor Changes

- Multi-session support: N concurrent MCP sessions can now drive one Chrome with no daemon.
  Each bridge runs a leader/follower election on the extension port (`8787`); the leader owns
  the extension link and relays followers' RPCs over a new control port (`8788`,
  `MONKEYSEE_CONTROL_PORT`). Per-session tab state lives in each process, so sessions stay
  isolated and a leader handoff (leader exits → a follower re-elects) keeps each session on
  its own tab. The control channel reuses the existing `RpcRequest`/`RpcResponse`/`hello`
  wire format and protocol-version handshake — no protocol bump, and the single-session path
  is unchanged.

## 0.2.0

### Minor Changes

- Add `init` and `doctor` subcommands. `monkeysee-bridge init` wires the server into an MCP client in one command (Claude Code via the official CLI or a `.mcp.json`, or Codex via `~/.codex/config.toml`) and prints the bundled extension path; flags: `--scope`, `--client`, `--print`. `monkeysee-bridge doctor` checks the live bridge/extension link and reports OK / DOWN / INCOMPATIBLE.

## 0.1.0

### Minor Changes

- d37a190: M0: content-script MVP. Adds the wire protocol (`monkeysee-protocol`) and the MCP
  bridge (`monkeysee-bridge`) that exposes browser observation and actions as MCP
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
  - monkeysee-protocol@0.1.0
