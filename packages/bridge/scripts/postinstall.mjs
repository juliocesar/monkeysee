// Printed after `npm install @monkeysee/bridge`. Points the user at the bundled,
// unpacked extension so they can load it in Chrome. Stays silent (exit 0) when the
// build hasn't run yet — e.g. during local `pnpm install` in the monorepo, where
// postinstall fires before `pnpm build`. Never fail an install over a message.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ext = fileURLToPath(new URL('../dist/extension', import.meta.url))
if (!existsSync(ext)) process.exit(0)

console.log(`
MonkeySee extension is installed at:

  ${ext}

To load it in Chrome:
  1. Open chrome://extensions
  2. Enable "Developer mode" (top-right)
  3. Click "Load unpacked" and select the path above
`)
