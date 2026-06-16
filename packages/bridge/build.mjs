import * as esbuild from 'esbuild'

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
if (watch) {
  const ctx = await esbuild.context(opts)
  await ctx.watch()
  console.log('bridge: watching')
} else {
  await esbuild.build(opts)
}
