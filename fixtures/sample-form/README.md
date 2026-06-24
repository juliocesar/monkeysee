# MonkeySee sample form

A small **shadcn/ui** form used as a live test target for MonkeySee — driving a real Chrome
profile through `get_forms` / `fill_fields` (both `batch` and `progressive` modes), dropdowns,
checkboxes, radios, switches, and a submit round-trip.

It is a deliberately diverse form (a fake "Conference Speaker Application") covering every
field kind MonkeySee handles:

- text inputs (name / email / company) and a **textarea** (talk abstract)
- two **Radix Select** dropdowns — Track, Experience level (non-native: a custom combobox plus
  a hidden `<select>`, which is the interesting case for the indexer and click-through)
- a **radio group** (session length)
- four **checkboxes** (topics, uncontrolled) plus a consent checkbox (controlled)
- a **switch** (newsletter, controlled)
- a submit button that is disabled until consent is checked, and renders the captured payload
  as JSON on submit — a clear visual confirmation for recordings.

## Running it

This fixture is **not** part of the repo's pnpm workspace (it has its own
`pnpm-workspace.yaml` so installing it never touches the root lockfile). Install and run it on
its own:

```sh
cd fixtures/sample-form
pnpm install
pnpm dev        # serves on http://localhost:5180 (fixed port)
```

Then point MonkeySee at `http://localhost:5180/`.

## Notes

- `node_modules/` and `dist/` are git-ignored; the source + lockfile are committed so the
  fixture is reproducible.
- The port is pinned to **5180** (`vite.config.ts`) so tests and recordings always hit the
  same URL.
- Throwaway by design — edit it freely to exercise new MonkeySee behaviors.
