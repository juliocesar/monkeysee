// Rasterize static/icon.svg into the MV3 icon sizes (16/48/128) under static/icons/.
// Requires librsvg's `rsvg-convert` on PATH (brew install librsvg). Run after editing
// the SVG source: `node scripts/make-icons.mjs`.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const svg = `${root}/static/icon.svg`
const sizes = [16, 48, 128]

for (const size of sizes) {
  const out = `${root}/static/icons/${size}.png`
  const r = spawnSync(
    'rsvg-convert',
    ['-w', String(size), '-h', String(size), '-o', out, svg],
    { stdio: 'inherit' },
  )
  if (r.status !== 0) throw new Error(`rsvg-convert failed for ${size}px`)
  console.log(`icons: wrote ${out}`)
}
