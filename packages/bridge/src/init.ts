// `monkeysee-bridge init` — the one-command wiring experience. Registers the MCP server
// with the user's client and points them at the bundled extension to load in Chrome.
//
// We deliberately do NOT auto-run this from postinstall: silently editing a user's global
// agent config is invasive and client-ambiguous. `init` is explicit (the user typed it),
// asks via flags which client/scope, and prefers the official `claude` CLI so the merge
// into ~/.claude.json is handled safely rather than hand-rolled.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_NAME = 'monkeysee'
const COMMAND = 'npx'
const ARGS = ['-y', 'monkeysee-bridge']

type Scope = 'user' | 'project'
type Client = 'claude' | 'codex'

interface Options {
  scope: Scope
  client: Client
  print: boolean
  help: boolean
}

/** Entry point for the `init` subcommand. Writes to stdout (this is a human, not MCP). */
export function runInit(argv: string[]): void {
  let opts: Options
  try {
    opts = parse(argv)
  } catch (err) {
    console.error(`[monkeysee] ${(err as Error).message}`)
    console.error('Run `monkeysee-bridge init --help` for usage.')
    process.exit(2)
  }

  if (opts.help) {
    printHelp()
    return
  }

  if (opts.print) {
    printConfig(opts)
    printExtension()
    return
  }

  if (opts.client === 'codex') {
    wireCodex(opts)
  } else {
    wireClaude(opts)
  }
  printExtension()
}

function parse(argv: string[]): Options {
  const opts: Options = { scope: 'user', client: 'claude', print: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) continue
    if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg === '--print') opts.print = true
    else if (arg === '--scope') opts.scope = value(argv, ++i, '--scope') as Scope
    else if (arg.startsWith('--scope=')) opts.scope = arg.slice('--scope='.length) as Scope
    else if (arg === '--client') opts.client = value(argv, ++i, '--client') as Client
    else if (arg.startsWith('--client=')) opts.client = arg.slice('--client='.length) as Client
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (opts.scope !== 'user' && opts.scope !== 'project')
    throw new Error(`--scope must be "user" or "project" (got "${opts.scope}")`)
  if (opts.client !== 'claude' && opts.client !== 'codex')
    throw new Error(`--client must be "claude" or "codex" (got "${opts.client}")`)
  return opts
}

function value(argv: string[], i: number, flag: string): string {
  const v = argv[i]
  if (v === undefined || v.startsWith('-')) throw new Error(`${flag} expects a value`)
  return v
}

function wireClaude(opts: Options): void {
  // Prefer the official CLI: it merges into the right place (user scope lives in
  // ~/.claude.json; project scope writes ./.mcp.json) without us reimplementing it.
  if (hasClaudeCli()) {
    const r = spawnSync(
      'claude',
      ['mcp', 'add', SERVER_NAME, '--scope', opts.scope, '--', COMMAND, ...ARGS],
      { stdio: 'inherit' },
    )
    if (r.status === 0) {
      console.log(`[monkeysee] registered "${SERVER_NAME}" with Claude Code (${opts.scope} scope).`)
      return
    }
    console.error('[monkeysee] `claude mcp add` failed; falling back to manual config.')
  }

  // No CLI (or it failed). Project scope is a standalone file we can safely write; user
  // scope means touching ~/.claude.json, which we leave to the CLI — so we just instruct.
  if (opts.scope === 'project') {
    const path = writeMcpJson(process.cwd())
    console.log(`[monkeysee] wrote "${SERVER_NAME}" to ${path}`)
    return
  }
  console.log('[monkeysee] Claude Code CLI not found on PATH. Register it manually:\n')
  printConfig(opts)
}

function wireCodex(opts: Options): void {
  // Codex reads MCP servers from ~/.codex/config.toml. We avoid a TOML parser dependency:
  // a server is its own `[mcp_servers.<name>]` table, and table order is irrelevant, so
  // we append the block when absent and never rewrite an existing one (don't clobber the
  // user's hand-edits). That's an append-if-absent, not a full merge.
  const block = [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = "${COMMAND}"`,
    `args = [${ARGS.map(a => `"${a}"`).join(', ')}]`,
  ].join('\n')

  if (opts.print) {
    console.log('Add this to your Codex config (~/.codex/config.toml):\n')
    console.log(block)
    return
  }

  const path = resolve(homedir(), '.codex', 'config.toml')
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  if (new RegExp(`^\\s*\\[mcp_servers\\.${SERVER_NAME}\\]`, 'm').test(existing)) {
    console.log(`[monkeysee] "${SERVER_NAME}" is already in ${path}; left it unchanged.`)
    return
  }
  const sep = existing === '' ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, existing + sep + block + '\n')
  console.log(`[monkeysee] added "${SERVER_NAME}" to ${path}`)
}

function writeMcpJson(cwd: string): string {
  const path = resolve(cwd, '.mcp.json')
  let config: { mcpServers?: Record<string, { command: string; args: string[] }> } = {}
  if (existsSync(path)) {
    try {
      config = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      throw new Error(`${path} exists but is not valid JSON; fix or remove it first.`)
    }
  }
  config.mcpServers ??= {}
  config.mcpServers[SERVER_NAME] = { command: COMMAND, args: ARGS }
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n')
  return path
}

function hasClaudeCli(): boolean {
  // status is null (not 0) when the binary is missing (ENOENT), so this also covers that.
  return spawnSync('claude', ['--version'], { stdio: 'ignore' }).status === 0
}

function printConfig(opts: Options): void {
  if (opts.client === 'codex') {
    wireCodex(opts)
    return
  }
  console.log('Register for all projects:\n')
  console.log(`  claude mcp add ${SERVER_NAME} -s ${opts.scope} -- ${COMMAND} ${ARGS.join(' ')}\n`)
  console.log('Or add this to a project .mcp.json:\n')
  console.log(
    JSON.stringify({ mcpServers: { [SERVER_NAME]: { command: COMMAND, args: ARGS } } }, null, 2),
  )
}

function printExtension(): void {
  const path = fileURLToPath(new URL('./extension', import.meta.url))
  if (!existsSync(path)) return
  console.log(`\n[monkeysee] Chrome extension is bundled at:\n\n  ${path}\n`)
  console.log('Load it once in Chrome:')
  console.log('  1. Open chrome://extensions')
  console.log('  2. Enable "Developer mode" (top-right)')
  console.log('  3. Click "Load unpacked" and select the path above\n')
}

function printHelp(): void {
  console.log(`monkeysee-bridge init - wire MonkeySee into your MCP client

Usage:
  monkeysee-bridge init [options]

Options:
  --scope <user|project>   Where to register (default: user). "project" writes ./.mcp.json.
  --client <claude|codex>  Target client (default: claude).
  --print                  Print the config and extension path without writing anything.
  -h, --help               Show this help.

Examples:
  monkeysee-bridge init                  Register with Claude Code for every project.
  monkeysee-bridge init --scope project  Write ./.mcp.json for this repo only.
  monkeysee-bridge init --client codex   Print the Codex config snippet.
`)
}
