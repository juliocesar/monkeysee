# Build & packaging notes

Non-obvious things that will bite a fresh session. See `STRUCTURE.md` for the project map.

- **Declaration emit differs per package.** `protocol` is pure types + zod and builds with
  **`tsc` only** (emits JS *and* `.d.ts`). `bridge` bundles JS with **esbuild** and emits
  **types only** via `tsc --emitDeclarationOnly`. Both use a `tsconfig.build.json`.
- **Phantom-dependency rule (pnpm, strict non-hoisted `node_modules`).** Every package whose
  `build.mjs` imports `esbuild` must list `esbuild` in its **own** `devDependencies` (so:
  `bridge` and `extension`); same for `typescript` in any package that runs `tsc`. The root
  devDep copy is only for root scripts (lint/format).
- **TypeScript 6 needs explicit `rootDir: "src"`** in the emitting tsconfigs (`protocol`,
  `bridge`).
- **`protocol` uses explicit `.js` import extensions** and is marked `"sideEffects": false`,
  so its emitted ESM runs under Node *and* esbuild tree-shakes zod out of the service-worker
  bundle (~556KB → ~10KB).
- **`@types/node` is a `bridge` devDependency** (tsc needs it for `process`, etc.).
- **`debugger` is a required permission** (Chrome forbids it in `optional_permissions`); the
  popup toggle selects the backend via `chrome.storage` `backend`, not whether the permission
  is granted. **`alarms`** is also required (keepalive).
- **The bridge bundles the extension.** `packages/bridge/build.mjs` builds the extension
  (spawns its `build.mjs`) and copies its `dist/` into `dist/extension/` — the extension is
  *not* a bridge dependency, so `pnpm -r` order isn't guaranteed; the explicit spawn makes
  freshness deterministic. `files: ["dist", "scripts"]` ships both `dist/extension/` and the
  `postinstall` script. The `--watch` build skips the copy (one-shot is for release builds).
- **`postinstall` must never fail an install.** `scripts/postinstall.mjs` resolves the
  extension path from its own location (`import.meta.url`, not cwd) and exits 0 silently when
  `dist/extension` is missing — which is the normal case during a fresh monorepo
  `pnpm install`, before anything is built.
- **The SW pulls focus on navigation:** it activates the controlled tab on every command and
  brings the window forward on `open_tab`/`navigate`/`go_back`/`go_forward` so the user can
  watch.
