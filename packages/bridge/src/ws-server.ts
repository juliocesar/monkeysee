import { WebSocketServer, type WebSocket } from 'ws'
import type { BridgeEvent, RpcMethod, RpcRequest, RpcResponse, RpcError } from 'monkeysee-protocol'
import { PROTOCOL_VERSION, isProtocolCompatible } from 'monkeysee-protocol'

/** Error thrown when an RPC call fails; carries the structured RpcError. */
export class RpcCallError extends Error {
  constructor(public readonly rpc: RpcError) {
    super(rpc.message)
    this.name = 'RpcCallError'
  }
}

interface Pending {
  resolve: (result: unknown) => void
  reject: (err: RpcCallError) => void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Owns the WS server the extension connects to. Translates `call()` into an
 * RpcRequest, correlates the matching RpcResponse by id, and resolves/rejects.
 * Deliberately dumb: no DOM knowledge, just request/response plumbing.
 */
export class WsServer {
  private readonly wss: WebSocketServer
  private socket: WebSocket | null = null
  private readonly pending = new Map<string, Pending>()
  private counter = 0
  private extensionVersion: string | null = null

  constructor(port: number, host = '127.0.0.1') {
    this.wss = new WebSocketServer({ host, port })
    this.wss.on('connection', ws => this.onConnection(ws))
    this.wss.on('listening', () => console.error(`[monkeysee] ws listening on ${host}:${port}`))
    this.wss.on('error', err => console.error('[monkeysee] ws server error', err))
  }

  get connected(): boolean {
    return this.socket !== null && this.socket.readyState === this.socket.OPEN
  }

  get version(): string | null {
    return this.extensionVersion
  }

  private onConnection(ws: WebSocket): void {
    // Latest connection wins. Drop any prior socket.
    if (this.socket && this.socket !== ws) {
      try {
        this.socket.close()
      } catch {
        // ignore
      }
    }
    this.socket = ws
    console.error('[monkeysee] extension connected')

    ws.on('message', data => this.onMessage(data.toString(), ws))
    ws.on('close', () => {
      if (this.socket === ws) {
        this.socket = null
        this.extensionVersion = null
        console.error('[monkeysee] extension disconnected')
        this.failAllPending({ code: 'internal', message: 'extension disconnected' })
      }
    })
    ws.on('error', err => console.error('[monkeysee] socket error', err))
  }

  private onMessage(raw: string, ws: WebSocket): void {
    let msg: unknown
    try {
      msg = JSON.parse(raw)
    } catch {
      console.error('[monkeysee] dropping non-JSON ws message')
      return
    }

    // Unsolicited event (e.g. hello handshake).
    if (msg && typeof msg === 'object' && 'type' in msg) {
      const ev = msg as { type: string; extensionVersion?: string; protocolVersion?: string }
      if (ev.type === 'hello') this.onHello(ws, ev.extensionVersion, ev.protocolVersion)
      return
    }

    // RpcResponse correlated by id.
    const res = msg as RpcResponse
    if (!res || typeof res.id !== 'string') return
    const p = this.pending.get(res.id)
    if (!p) return
    this.pending.delete(res.id)
    clearTimeout(p.timer)
    if (res.ok) p.resolve(res.result)
    else p.reject(new RpcCallError(res.error))
  }

  /**
   * Handle the `hello` handshake. Refuse (and drop) any extension whose protocol major
   * does not match the bridge's, so we never serve RPCs across an incompatible gap.
   */
  private onHello(ws: WebSocket, extensionVersion?: string, protocolVersion?: string): void {
    const remoteProtocol = protocolVersion ?? 'unknown'
    if (!isProtocolCompatible(remoteProtocol, PROTOCOL_VERSION)) {
      console.error(
        `[monkeysee] refusing extension: protocol ${remoteProtocol} is incompatible with ` +
          `bridge protocol ${PROTOCOL_VERSION}. Update whichever side is older.`,
      )
      const refusal: BridgeEvent = {
        type: 'incompatible',
        bridgeProtocolVersion: PROTOCOL_VERSION,
        extensionProtocolVersion: remoteProtocol,
      }
      try {
        ws.send(JSON.stringify(refusal))
      } catch {
        // socket may already be closing
      }
      // Drop the connection; clear state if this was the active socket.
      if (this.socket === ws) {
        this.socket = null
        this.extensionVersion = null
      }
      try {
        ws.close(4001, 'protocol-incompatible')
      } catch {
        // ignore
      }
      return
    }
    this.extensionVersion = extensionVersion ?? 'unknown'
    console.error(
      `[monkeysee] hello from extension v${this.extensionVersion} (protocol ${remoteProtocol})`,
    )
  }

  private failAllPending(error: RpcError): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new RpcCallError(error))
    }
    this.pending.clear()
  }

  /**
   * Send an RPC to the extension and await its response.
   * Rejects with RpcCallError on failure, timeout, or disconnection.
   */
  call(
    method: RpcMethod,
    params: unknown,
    opts: { tabId?: number; timeoutMs?: number } = {},
  ): Promise<unknown> {
    if (!this.connected || !this.socket) {
      return Promise.reject(
        new RpcCallError({
          code: 'internal',
          message:
            'Extension not connected. Open Chrome with the MonkeySee extension loaded; ' +
            'it will connect to the bridge automatically.',
        }),
      )
    }

    const id = `r${++this.counter}`
    const req: RpcRequest = { id, method, params, tabId: opts.tabId }
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new RpcCallError({
            code: 'timeout',
            message: `${method} timed out after ${timeoutMs}ms`,
          }),
        )
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.socket!.send(JSON.stringify(req))
    })
  }

  close(): void {
    this.failAllPending({ code: 'internal', message: 'bridge shutting down' })
    this.wss.close()
  }
}
