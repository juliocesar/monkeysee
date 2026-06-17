# Project structure

A pnpm workspace with three packages. The terminal agent (Claude Code / Codex) is the
brain; this repo is the hands and eyes, exposed as **MCP tools**.

```
Claude Code ──MCP(stdio)──▶ @monkeysee/bridge ──ws://localhost:8787──▶ extension SW ──▶ content script (DOM)
   (brain)                   (dumb router)                            (dumb router)     (smart: eyes + hands)
```

## Packages

### `packages/protocol` — `@monkeysee/protocol` (published to npm)

The wire spine: shared types + zod schemas. No logic. Built with `tsc` (emits JS + d.ts).

| File           | Purpose                                                                    |
| -------------- | -------------------------------------------------------------------------- |
| `src/state.ts` | `PageState`, `ElementHandle`, `Viewport`, `Box` (CSS px, viewport-relative) |
| `src/rpc.ts`   | `RpcRequest` / `RpcResponse` / `RpcError` / `RpcMethod` (bridge ↔ SW)        |
| `src/tools.ts` | zod param schemas for every MCP tool (`GetStateParams`, `ClickParams`, …)    |
| `src/index.ts` | re-exports + `PROTOCOL_VERSION` + `isProtocolCompatible` (the `hello` handshake check) |

### `packages/bridge` — `@monkeysee/bridge` (published to npm, has a `bin`)

MCP server (stdio) + WebSocket server. Dumb translator: MCP tool call → WS RPC → result.
Bundled with esbuild (ESM Node); types emitted by `tsc`. **Logs only to stderr.**

| File                | Purpose                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| `src/index.ts`      | bin entry: start WS server + MCP stdio transport; signal handling; prints bundled `dist/extension` path to stderr |
| `build.mjs`         | esbuild the server, then build + copy the extension into `dist/extension/`     |
| `scripts/postinstall.mjs` | after `npm install`, prints the bundled extension path + Load-unpacked steps (silent if `dist/extension` absent) |
| `src/ws-server.ts`  | WS server; request/response correlation by id; per-call timeout; `RpcCallError`; `hello` protocol-major check (refuses incompatible extensions) |
| `src/mcp-server.ts` | builds the `McpServer` and registers tools                                    |
| `src/tools.ts`      | every MCP tool (name, description, zod schema, handler); `done` grounding here  |
| `test/e2e.mjs`      | browser-free end-to-end test (fake extension WS + real MCP client). `pnpm test` |

### `packages/extension` — `extension` (MV3; bundled into `@monkeysee/bridge`)

The only component with DOM access. SW + content built with esbuild (SW = ESM,
content = IIFE). Load unpacked from `dist/`. Not published on its own and not on the Chrome
Web Store — the bridge build copies this `dist/` into `@monkeysee/bridge`'s `dist/extension/`
so one npm install ships the server and the extension together.

**Background (service worker — dumb router + lifecycle):**

| File                          | Purpose                                                                  |
| ----------------------------- | ------------------------------------------------------------------------ |
| `src/background/index.ts`     | SW entry: init nav + debugger, start WS client, popup status message     |
| `src/background/ws-client.ts` | connect to bridge, reconnect w/ backoff, `chrome.alarms` keepalive, `hello`; handles `incompatible` refusal (slow retry + popup status) |
| `src/background/router.ts`    | route RPC → tab/nav APIs or content script; per-frame fan-out + aggregate; safety gate; backend selection |
| `src/background/nav.ts`       | per-tab loading state via `webNavigation`; `onceSettled` for `wait_for_load` |
| `src/background/debugger-backend.ts` | M1 trusted input: CDP `Input.dispatch*` (mouse/keys/insertText) via `chrome.debugger` |
| `src/background/screenshot.ts` | M2 visual fallback: `captureVisibleTab` PNG; set-of-marks via `OffscreenCanvas` |

**Content (the smart part — eyes + hands):**

| File                       | Purpose                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| `src/content/index.ts`     | message dispatcher; `wait_quiet` (MutationObserver); `locate` (coords for CDP) |
| `src/content/indexer.ts`   | build `PageState`: candidate collection, visibility filter, role/name, ranking, `limit`; `frameOffset` (top-viewport coords for iframes) |
| `src/content/handles.ts`   | index → Element registry; stale re-resolution; `cssPath` / `accessibleName` / `roleOf` |
| `src/content/actions.ts`   | synthetic-event backend: click/type/scroll/press/etc. (M0 fallback)         |

**Shared / static:**

| File                       | Purpose                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| `src/shared/messages.ts`   | SW ↔ content message types (`ContentRequest` / `ContentResponse`)   |
| `manifest.json`            | MV3 manifest (`debugger` required; `all_frames:true` since M2)      |
| `static/popup.html` + `.js`| status, allowlist editor, trusted-input toggle                      |
| `static/icons/`            | generated PNG icons (16/48/128)                                     |

## MCP tool surface (what the agent sees)

- **Observation:** `get_state` (`withScreenshot` adds set-of-marks), `extract_text`, `screenshot`
- **Semantic actions** (by `index`): `click`, `type`, `select_option`, `hover`, `focus`
- **Spatial/raw:** `click_at`, `scroll`, `scroll_to`, `drag`, `press`, `type_text`
- **Navigation:** `open_tab`, `navigate`, `go_back`, `go_forward`, `wait_for_load`
- **Tabs:** `list_tabs` (id, url, title, active, controlled), `switch_tab(tabId)`, `close_tab(tabId)`
- **Control:** `done` (grounds the answer with URL + page snippet; handled in the bridge)

Every observation/action/navigation tool also takes an optional `tabId` to target a
specific tab without changing which tab is controlled. Omitted, it operates on the
controlled tab (set by `open_tab`/`switch_tab`, else the active tab). The target rides on
the `RpcRequest` envelope (`tabId`), not inside the tool params; the bridge splits it off
and the SW router resolves it via `pickTab`/`resolveTab`.

## Action backends

Mutating actions run through one of two backends, selectable in the popup
(`chrome.storage.backend`):

- **`content`** (default) — synthetic DOM events (`src/content/actions.ts`).
- **`debugger`** (M1) — trusted CDP input (`src/background/debugger-backend.ts`). The SW
  resolves an element's coords via the content `locate` message, then dispatches. Falls
  back to `content` on attach failure. Same MCP surface either way.

## Root

| File                  | Purpose                                                  |
| --------------------- | -------------------------------------------------------- |
| `pnpm-workspace.yaml` | workspace packages glob                                  |
| `tsconfig.base.json`  | strict shared TS config (esbuild bundles; tsc typechecks) |
| `eslint.config.js`    | flat config (ESLint 9 + only-warn + prettier)            |
| `.mcp.json`           | Claude Code MCP entry that launches the bridge           |
| `.changeset/`         | pending release notes for the published packages         |

## Design decisions

Settled rationale — the "why" behind the shape above. The code is the source of truth where
it disagrees.

1. **MCP, not a custom loop.** We expose tools only; the CLI agent reasons and decides
   "done". No LLM/AI-SDK code lives here.
2. **Monorepo (pnpm workspace + Changesets, no Turborepo).** Justified by publishing
   `@monkeysee/protocol` + `@monkeysee/bridge` to npm that, together with the bundled
   extension, must share a wire protocol in lockstep. Kept light on purpose.
3. **Page representation: indexed element list with bounding boxes** (`PageState`) — not
   full HTML, not screenshots by default. One payload serves semantic actions
   (`click(index)`), spatial actions (`click_at(x,y)`), set-of-marks, and frame merging.
4. **Coordinates: CSS pixels, viewport-relative** — what `getBoundingClientRect()` returns
   and `elementFromPoint()` consumes. `scrollX/Y` + `dpr` ride in `PageState` for
   page-relative and device-pixel (screenshot) conversions.
5. **Capability ramp: content-script first, `chrome.debugger` later.** Action verbs are
   defined abstractly so swapping the backend is invisible to the agent (see Action backends
   above).
6. **Frame-proofing baked in.** Handles are namespaced `frameId * FRAME_STRIDE + localId`;
   state is assembled by an aggregator; the content script is frame-agnostic (reports its
   own `frameId`). M2 flipped `all_frames: true` without a rewrite.
7. **Spatial/raw verbs are first-class** (`click_at`, `scroll`, `drag`, `press`,
   `type_text`), not just semantic ones — which is why boxes live in `PageState`.
8. **Toolchain: Node 24, pnpm 10, TypeScript 6, zod 4, esbuild.** ESLint stays on **9** on
   purpose: `eslint-plugin-only-warn` (unmaintained, patches eslint internals) is unverified
   on ESLint 10. Dropping `only-warn` is the path to ESLint 10 later (it's a convenience,
   not load-bearing).
9. **Bundler: esbuild everywhere.** Content script = **IIFE** (content scripts can't be ES
   modules), service worker = **ESM**, bridge = **ESM Node**. No Vite/WXT/@crxjs.
10. **Safety from M0 (minimal).** Domain allowlist + a confirmation-gate concept for
    destructive actions; the agent drives a logged-in browser, so treat it as such.
11. **Ship the extension unpacked, bundled in `@monkeysee/bridge` — no Chrome Web Store.**
    One `npm install` delivers the server and the extension's `dist/` together; users Load
    unpacked from a path that `postinstall` and the bridge's startup line both print. Avoids
    a second distribution channel, Web Store review latency, and a separately-versioned
    artifact — the protocol contract already keeps bridge and extension in lockstep.

## Further reading

- [`BUILD.md`](./BUILD.md) — build & packaging gotchas (declaration emit, pnpm phantom
  deps, tree-shaking, required permissions).
- [`../plans/WHATS_NEXT.md`](../plans/WHATS_NEXT.md) — forward-looking backlog (git-excluded).
