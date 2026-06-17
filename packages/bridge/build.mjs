import * as esbuild from 'esbuild'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const watch = process.argv.includes('--watch')
const opts = {
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: { js: '#!/usr/bin/env node' },
  // Keep deps external; they are installed from the published package.
  packages: 'external',
  sourcemap: true,
}
// Bundle the built extension into the bridge so a single `@monkeysee/bridge`
// install ships both the MCP server and the unpacked extension (no Chrome Web
// Store). The extension is not a dependency of the bridge, so `pnpm -r` order
// isn't guaranteed — build it explicitly here, then copy its dist.
function bundleExtension() {
  const extDir = fileURLToPath(new URL('../extension', import.meta.url))
  if (!existsSync(extDir)) return // not in the monorepo (e.g. published consumer)
  const r = spawnSync('node', ['build.mjs'], { cwd: extDir, stdio: 'inherit' })
  if (r.status !== 0) throw new Error('extension build failed')
  const extDist = fileURLToPath(new URL('../extension/dist', import.meta.url))
  const dest = fileURLToPath(new URL('./dist/extension', import.meta.url))
  rmSync(dest, { recursive: true, force: true })
  cpSync(extDist, dest, { recursive: true })
  console.log('bridge: bundled extension into dist/extension')
}

if (watch) {
  const ctx = await esbuild.context(opts)
  await ctx.watch()
  console.log('bridge: watching')
} else {
  await esbuild.build(opts)
  bundleExtension()
}
