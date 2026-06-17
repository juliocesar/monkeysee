# 🐵 MonkeySee

> Monkey see, monkey do. Your agent gets eyes and hands in a real Chrome.

MonkeySee lets an MCP client (Claude Code, Codex, or anything that speaks MCP) drive a
real, logged-in Chrome profile. It opens tabs, reads the page as a compact indexed list of
elements, clicks, types, scrolls, takes screenshots, and decides when the job is done.

The key word is **your** Chrome. Not a fresh headless sandbox that gets logged out of
everything. The actual browser where you are already signed into your email, your dashboard,
your everything.

<video src="https://github.com/juliocesar/monkeysee/raw/main/docs/demo.mp4" controls muted playsinline width="640"></video>

## This is not an agent

Let's be clear about who does the thinking. MonkeySee has **no agent loop, no LLM, no
"reasoning."** Your terminal agent already has all of that. MonkeySee is the dumb,
fast, reliable set of hands and eyeballs it has always wanted.

```
  the brain                          the hands & eyes
┌─────────────┐   MCP (stdio)   ┌──────────────────┐   ws://localhost:8787   ┌───────────┐
│ Claude Code │ ───────────────▶│ monkeysee-bridge │ ──────────────────────▶│ extension │
│   / Codex   │                 │  (dumb router)   │                         │ SW + DOM  │
└─────────────┘                 └──────────────────┘                         └───────────┘
```

The agent decides _what_ to do. MonkeySee just does it and reports back what it saw.

## What your agent can do

Once it's wired up, your agent gets a toolbox:

- **Look:** `get_state` (the page as a numbered element list, optionally with a
  set-of-marks screenshot), `extract_text`, `screenshot`
- **Act on what it sees:** `click`, `type`, `select_option`, `hover`, `focus` (all by element index)
- **Act by hand:** `click_at`, `scroll`, `scroll_to`, `drag`, `press`, `type_text`
- **Get around:** `open_tab`, `navigate`, `go_back`, `go_forward`, `wait_for_load`
- **Juggle tabs:** `list_tabs`, `switch_tab`, `close_tab`
- **Call it:** `done` (grounds the answer with the final URL + a page snippet)

## What you can do with it

The point of driving _your_ logged-in Chrome is that the agent can act on the context it
already has in your terminal session and the sites you're already signed into. A few
workflows that fall out of that:

- **Fill forms with context the agent already has.** Point Claude Code or Codex at a signup,
  job application, expense report, or vendor onboarding form and let it populate the fields
  from a file, a prior conversation, or your repo. It reads the form as an indexed element
  list, types into each field, and tells you what it entered before submitting.
- **Pull data out of dashboards that have no API.** Analytics, billing, internal admin
  panels you're logged into. The agent navigates, `extract_text`s, and hands back structured
  notes, no scraping credentials or headless re-login required.
- **Reproduce and triage a bug from a report.** Hand it the repro steps; it clicks through
  your staging app, screenshots each state, and reports where the flow actually breaks.
- **File the boring tickets.** Open Jira/Linear/GitHub, create issues from a list in your
  conversation, and link them back, all in the tab where you're already authenticated.
- **Cross-check work against a live site.** Diff what your code _should_ render against what
  the deployed page actually shows, with set-of-marks screenshots to point at the mismatch.
- **Drive multi-step web flows you'd rather not script.** Cookie banners, paginated tables,
  multi-page wizards: the agent re-reads the page after each step instead of relying on a
  brittle recorded selector.

In all of these the agent is the brain and MonkeySee is the hands. You stay in the loop,
the allowlist gates anything mutating, and every action reports back what it saw.

## Install

One install ships both halves. There is no Chrome Web Store listing to hunt for.

```bash
npm install -g monkeysee-bridge
```

The install prints exactly where the bundled extension lives. Then teach Chrome about it:

1. Open `chrome://extensions`
2. Flip on **Developer mode** (top-right)
3. Click **Load unpacked** and pick the path the installer printed

Finally, point your MCP client at the bridge. For example, in `.mcp.json`:

```json
{ "mcpServers": { "monkeysee": { "command": "npx", "args": ["-y", "monkeysee-bridge"] } } }
```

Missed the path during install? No problem. The bridge reprints it to stderr every time it
starts, so it's right there in your MCP logs.

## The 60-second demo

The bridge is fully testable from the CLI (`pnpm test`, no browser). The full loop needs
Chrome:

1. **Build:** `pnpm build`
2. **Load the extension:** `chrome://extensions` → Developer mode → Load unpacked →
   `packages/extension/dist`. (The published `monkeysee-bridge` ships the extension inside
   it, and both the installer and the bridge's startup line print the path to load.)
3. **Start Claude Code** here. Copy `.mcp.json.example` to `.mcp.json` first (it's
   git-ignored, so it stays local). That entry launches the bridge over stdio. Within a few
   seconds the extension's service worker connects to the bridge. Look for the green dot in
   the extension popup.
4. **Give it a job.** Be explicit that it should use the browser, otherwise a capable agent
   will just answer from memory or its own web search and never touch MonkeySee. Try:
   _"Using the monkeysee browser tools, find me a Wikipedia article about Wales."_ It should
   `open_tab`, `get_state`, `type` into search, `press('Enter')` or `click`, re-read,
   `extract_text`, and `done` with the URL and a snippet.

> **`ws://localhost:8787` connection refused?** Totally normal when nothing is running. The
> bridge only listens while an MCP client has launched it. Start Claude Code here (the
> `.mcp.json` spawns it), or run it standalone to test the link:
> `node packages/bridge/dist/index.js`. The service worker reconnects with backoff, so order
> never matters. You'll see `extension connected` / `hello` on the bridge's stderr.

## Develop

```bash
pnpm install
pnpm build        # build all packages
pnpm dev          # watch all packages
pnpm typecheck
pnpm lint
pnpm test         # bridge end-to-end check (no browser needed)
```

Three packages in a pnpm workspace:

| Package               | Role                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `monkeysee-protocol` | Shared wire types + zod schemas. The compatibility spine. Published to npm.                                     |
| `monkeysee-bridge`   | MCP server (stdio) + WebSocket server. Translates tool calls to RPC. Published to npm with a `bin`.             |
| `extension`           | MV3 Chrome extension: service-worker router + content-script eyes/hands. Bundled into the bridge, loaded unpacked. |

The deep dive lives in [`docs/`](./docs): [`STRUCTURE.md`](./docs/STRUCTURE.md) (project map
+ design decisions) and [`BUILD.md`](./docs/BUILD.md) (build/packaging gotchas).

## Did it actually work? (M0 acceptance)

1. The agent ends on `https://en.wikipedia.org/wiki/Wales` and `done` returns a snippet
   mentioning Wales.
2. `get_state` on a busy page returns at most `limit` visible elements, each with a sensible
   `role` + `name` and a non-degenerate `box`.
3. A stale `click(index)` after navigation returns `stale_handle` (not a wrong click), and
   the agent recovers by re-reading with `get_state`.
4. Kill and restart the bridge: the extension reconnects within a few seconds, no reload
   needed.

## Safety (minimal, but real)

You are pointing a robot at a browser that's logged into your life. Treat it that way.

The extension popup has a **domain allowlist**. With **Enforce** on, mutating actions
(`click`, `type`, `select_option`, `click_at`, `drag`, `press`, `type_text`) on a domain
that isn't allowlisted return a `blocked` error. Looking and navigating are never gated.

## Trusted input (chrome.debugger)

By default, actions fire synthetic DOM events from the content script. Some sites are picky:
they check `event.isTrusted`, or shrug off a synthetic Enter in a search box.

Flip **"Trusted input (chrome.debugger)"** in the popup to route `click`, `type`,
`type_text`, `press`, `click_at`, and `drag` through real input dispatched via the Chrome
DevTools Protocol (`Input.dispatch*`). These events are trusted and behave like a real human
finger. Notes:

- `debugger` is a **required** permission (Chrome won't allow it as optional). It's only
  _used_ when you turn the toggle on.
- If attaching fails (say DevTools is already open on that tab), MonkeySee quietly falls back
  to synthetic events for that one action.
- The MCP tool surface is identical either way. The agent never knows or cares which backend
  ran.

### About that yellow "started debugging this browser" banner

Chrome itself shows the **"MonkeySee Browser Agent started debugging this browser"** infobar
the moment any extension calls `chrome.debugger.attach()`. In MonkeySee that happens **only**
when both are true:

1. the **Trusted input** backend is on in the popup, and
2. a debugger-backed action actually runs (`click`, `type`, `type_text`, `press`,
   `click_at`, or `drag`). Attach is lazy and per-tab, on the first such action, and the
   banner sticks around until MonkeySee detaches or the tab closes.

It does **not** show up for:

- opening a tab or navigating
- observation: `get_state`, `extract_text`
- `screenshot` / `get_state({ withScreenshot: true })` (these use
  `chrome.tabs.captureVisibleTab`, no debugger required)
- any action while the backend is left on the default `content` (synthetic events)

So: keep the backend on `content` and you'll never see the banner. Turn the trusted backend
on and you'll see it on each tab the first time MonkeySee dispatches input there.

## Frames + screenshots

- **Same-origin frames** are indexed automatically (`all_frames: true`). Elements inside a
  same-origin iframe show up in `get_state` with `frameId != 0`, are clickable by index, and
  report their boxes in top-viewport coordinates. Cross-origin iframes are out of scope for
  now.
- **`screenshot`** returns the controlled tab's visible viewport as a PNG.
- **`get_state({ withScreenshot: true })`** adds that image with numbered set-of-marks drawn
  over each in-viewport element. Great for the agent to "point" with confidence.

## Version compatibility

The bridge and extension swap a `protocolVersion` in the WebSocket `hello` handshake (the
contract lives in `monkeysee-protocol`). If their **major** versions disagree, the bridge
refuses the connection and never serves a tool call to a mismatched extension. The popup
shows an "incompatible bridge" status and the extension retries slowly until you update the
older side. Pre-1.0, both sides are major `0` and move in lockstep through the workspace, so
this only bites across a future breaking bump.

## License

MIT. See [`LICENSE`](./LICENSE).
