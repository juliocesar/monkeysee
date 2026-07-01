import * as esbuild from 'esbuild'
import { cpSync, mkdirSync } from 'node:fs'

const watch = process.argv.includes('--watch')
const outdir = 'dist'
mkdirSync(outdir, { recursive: true })

// Dev-only debug/latency logging is compiled in under `pnpm dev` (watch), with the
// `--debug` build flag (`pnpm build:debug`), or when MONKEYSEE_DEBUG=1 is set at build
// time; a plain released build (`pnpm build`) omits it, so the bundled/published extension
// never emits log traffic.
const dev = watch || process.argv.includes('--debug') || process.env.MONKEYSEE_DEBUG === '1'
const define = { __MONKEYSEE_DEV__: String(dev) }

// Content script MUST be a classic script (IIFE), no ESM, single file.
const content = {
  entryPoints: { content: 'src/content/index.ts' },
  outdir,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  sourcemap: true,
  define,
}

// Service worker CAN be an ES module.
const background = {
  entryPoints: { background: 'src/background/index.ts' },
  outdir,
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  sourcemap: true,
  define,
}

function copyStatic() {
  cpSync('manifest.json', `${outdir}/manifest.json`)
  cpSync('static', outdir, { recursive: true })
}

if (watch) {
  const c = await esbuild.context(content)
  const b = await esbuild.context(background)
  await c.watch()
  await b.watch()
  copyStatic()
  console.log('extension: watching')
} else {
  await esbuild.build(content)
  await esbuild.build(background)
  copyStatic()
}
