# MonkeySee

Let an MCP client (Claude Code, Codex, or any MCP client) drive a real, logged-in
Chrome profile: open tabs, read pages as a compact indexed element list, click, type,
scroll, and decide when a task is done.

We do **not** build an agent loop. Claude Code / Codex already have one. This project
exposes browser observation and actions as **MCP tools**. The terminal agent is the
brain; this is the hands and eyes.

See [`docs/STRUCTURE.md`](./docs/STRUCTURE.md) for a project map. (The full design doc,
`plans/BROWSER_AGENT_PLAN.md`, is kept local-only.)

## Packages

| Package               | Role                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@monkeysee/protocol` | Shared wire types + zod schemas (the compatibility spine). Published to npm.                                |
| `@monkeysee/bridge`   | MCP server (stdio) + WebSocket server. Translates tool calls to RPC. Published to npm with a `bin`.         |
| `extension`           | MV3 Chrome extension: service-worker router + content-script eyes/hands. Published to the Chrome Web Store. |

## Architecture

```
Claude Code / Codex  ──MCP(stdio)──▶  @monkeysee/bridge  ──ws://localhost:8787──▶  extension SW  ──▶  content script (DOM)
   (the brain)                         (dumb router)                                (dumb router)      (the smart part)
```

## Develop

```bash
pnpm install
pnpm build        # build all packages
pnpm dev          # watch all packages
pnpm typecheck
pnpm lint
pnpm test         # bridge end-to-end verification (no browser needed)
```

## Run the M0 acceptance task

The bridge is fully verifiable from the CLI (`pnpm test`). The full loop needs Chrome:

1. **Build:** `pnpm build`.
2. **Load the extension:** open `chrome://extensions`, enable Developer mode,
   "Load unpacked", select `packages/extension/dist`.
3. **Start Claude Code** in this directory. The `.mcp.json` here launches the bridge
   automatically (MCP over stdio). The extension's service worker connects to the
   bridge's WebSocket server within a few seconds — confirm the green dot in the
   extension popup.
4. **Drive it.** Ask the agent: _"find me a Wikipedia article about Wales."_ It should
   `open_tab`, `get_state`, `type` into search, `press('Enter')` / `click`, re-read,
   `extract_text`, and `done` with the URL + snippet.

> **`ws://localhost:8787` connection refused?** Expected when no bridge is running.
> The bridge only listens while an MCP client has launched it. Start Claude Code here
> (the `.mcp.json` spawns it), or run it standalone to test the connection:
> `node packages/bridge/dist/index.js` — the extension's service worker connects within
> a few seconds (you'll see `extension connected` / `hello` on the bridge's stderr). The
> service worker retries with backoff, so order doesn't matter.

### Acceptance criteria (M0)

1. The agent ends on `https://en.wikipedia.org/wiki/Wales` and `done` returns a snippet
   mentioning Wales.
2. `get_state` on a content-heavy page returns ≤ `limit` visible elements, each with a
   sensible `role` + `name` + non-degenerate `box`.
3. A stale `click(index)` after navigation returns `stale_handle` (not a wrong click);
   the agent recovers by re-reading with `get_state`.
4. Killing and restarting the bridge: the extension reconnects within a few seconds
   without reloading the extension.

## Safety (M0, minimal)

The extension popup has a domain allowlist. When **Enforce** is on, mutating actions
(`click`, `type`, `select_option`, `click_at`, `drag`, `press`, `type_text`) on a domain
not in the allowlist return a `blocked` error. Observation and navigation are never
gated.

## Trusted input (M1)

By default, actions use synthetic DOM events from the content script. Some sites reject
these (they check `event.isTrusted`, or ignore a synthetic Enter in a search box).

Toggle **"Trusted input (chrome.debugger)"** in the popup to switch `click`, `type`,
`type_text`, `press`, `click_at`, and `drag` to real input dispatched via the Chrome
DevTools Protocol (`Input.dispatch*`). These events are trusted and behave like a real
user. Notes:

- `debugger` is a **required** permission (Chrome forbids it as optional). It is only
  _used_ when you enable the toggle.
- If attaching fails (e.g. DevTools is open on that tab), MonkeySee silently falls back
  to the synthetic backend for that action.
- The MCP tool surface is identical — the agent is unaffected by the backend choice.

### When the "started debugging this browser" banner appears

The yellow **"MonkeySee Browser Agent started debugging this browser"** infobar is shown
by Chrome itself whenever an extension calls `chrome.debugger.attach()`. In MonkeySee that
happens **only** when both are true:

1. the **Trusted input** backend is enabled in the popup (`chrome.storage` `backend` =
   `debugger`), and
2. a debugger-backed action actually runs — `click`, `type`, `type_text`, `press`,
   `click_at`, or `drag`. Attach is lazy and **per-tab** (on the first such action), and
   the banner stays until MonkeySee detaches or the tab closes.

It does **not** appear for:

- opening a tab or navigating;
- observation — `get_state`, `extract_text`;
- `screenshot` / `get_state({ withScreenshot: true })` — these use
  `chrome.tabs.captureVisibleTab`, which needs no debugger;
- any action while the backend is left on the default `content` (synthetic events).

So if you keep the backend on `content`, you will never see the banner; with the trusted
backend on, you'll see it on each tab the moment MonkeySee first dispatches input there.

## Frames + screenshots (M2)

- **Same-origin frames** are indexed automatically (`all_frames: true`). Elements inside a
  same-origin iframe appear in `get_state` with `frameId != 0` and are clickable by index;
  their boxes are reported in top-viewport coordinates. Cross-origin iframes are out of
  scope for now.
- **`screenshot`** returns the controlled tab's visible viewport as a PNG.
- **`get_state({ withScreenshot: true })`** additionally returns that image with numbered
  set-of-marks drawn at each in-viewport element's box.
