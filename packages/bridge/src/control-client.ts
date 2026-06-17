import { WebSocket } from 'ws'
import { PROTOCOL_VERSION } from 'monkeysee-protocol'
import type { RpcEvent, RpcMethod, RpcRequest, RpcResponse } from 'monkeysee-protocol'
import { RpcCallError } from './ws-server'
import type { RpcBackend } from './session'

interface Pending {
  resolve: (result: unknown) => void
  reject: (err: RpcCallError) => void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Follower-side transport: frames RpcRequests to the leader's control server and correlates
 * RpcResponses by id (mirror of `WsServer.call` and the extension's `ws-client.ts`).
 * Implements `RpcBackend`, so a `Session` can use it interchangeably with a `WsServer`.
 *
 * Failures surface as `RpcCallError` (not plain strings) so `describeError` keeps producing
 * the same agent-facing messages regardless of leader/follower role.
 */
export class ControlClient implements RpcBackend {
  private socket: WebSocket | null = null
  private readonly pending = new Map<string, Pending>()
  private counter = 0
  private closed = false
  private incompatible = false

  constructor(
    private readonly url: string,
    private readonly opts: { onClose: () => void },
  ) {}

  /** Resolve after the socket opens and the hello is sent; reject on refuse/incompatible. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      let ws: WebSocket
      try {
        ws = new WebSocket(this.url)
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
        return
      }
      this.socket = ws

      ws.on('open', () => {
        const hello: RpcEvent = {
          type: 'hello',
          extensionVersion: PROTOCOL_VERSION,
          protocolVersion: PROTOCOL_VERSION,
        }
        ws.send(JSON.stringify(hello))
        settled = true
        console.error('[monkeysee] follower: connected to leader')
        resolve()
      })
      ws.on('message', data => this.onMessage(data.toString()))
      ws.on('error', () => {
        // Surfaces as a `close`; reject `connect()` if we never opened.
        if (!settled) {
          settled = true
          reject(new Error('control connection failed'))
        }
      })
      ws.on('close', () => {
        const reason = this.incompatible
          ? 'bridge peer protocol incompatible — update the older session'
          : 'leader connection lost'
        this.failAllPending({ code: 'internal', message: reason })
        if (!settled) {
          settled = true
          reject(new Error(reason))
        }
        if (!this.closed) {
          this.closed = true
          this.opts.onClose()
        }
      })
    })
  }

  call(
    method: RpcMethod,
    params: unknown,
    opts: { tabId?: number; timeoutMs?: number } = {},
  ): Promise<unknown> {
    const socket = this.socket
    if (!socket || socket.readyState !== socket.OPEN) {
      return Promise.reject(
        new RpcCallError({ code: 'internal', message: 'leader connection lost' }),
      )
    }
    const id = `f${++this.counter}`
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
      socket.send(JSON.stringify(req))
    })
  }

  close(): void {
    this.closed = true
    try {
      this.socket?.close()
    } catch {
      // ignore
    }
  }

  private onMessage(raw: string): void {
    let msg: unknown
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    // Leader -> follower control event (an incompatible-protocol refusal).
    if (msg && typeof msg === 'object' && 'type' in msg) {
      const ev = msg as { type: string }
      if (ev.type === 'incompatible') {
        this.incompatible = true
        console.error(
          '[monkeysee] follower: leader refused connection — protocol incompatible. ' +
            'Update whichever session is older.',
        )
      }
      return
    }

    // Reconstruct RpcCallError from the serialized RpcError so describeError is unchanged.
    const res = msg as RpcResponse
    if (!res || typeof res.id !== 'string') return
    const p = this.pending.get(res.id)
    if (!p) return
    this.pending.delete(res.id)
    clearTimeout(p.timer)
    if (res.ok) p.resolve(res.result)
    else p.reject(new RpcCallError(res.error))
  }

  private failAllPending(error: { code: 'internal' | 'timeout'; message: string }): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new RpcCallError(error))
    }
    this.pending.clear()
  }
}
