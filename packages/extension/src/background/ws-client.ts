import type { BridgeEvent, RpcRequest, RpcResponse } from '@monkeysee/protocol'
import { PROTOCOL_VERSION } from '@monkeysee/protocol'

const KEEPALIVE_ALARM = 'monkeysee-keepalive'
const MAX_BACKOFF = 5_000
/** Reconnect slowly after a protocol refusal — fast retries would only be refused again. */
const INCOMPATIBLE_RETRY = 30_000

export type Incompatible = Omit<BridgeEvent, 'type'>

/**
 * Maintains the connection to the bridge: connect, reconnect with backoff, and a
 * ~24s keepalive alarm so the MV3 service worker does not idle out mid-task.
 * Dumb pipe: incoming RpcRequests go to `onRequest`, its RpcResponse goes back.
 */
export class WsClient {
  private socket: WebSocket | null = null
  private backoff = 250
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connected = false
  /** Set when the bridge refused us for an incompatible protocol major; null otherwise. */
  private incompatible: Incompatible | null = null

  constructor(
    private readonly url: string,
    private readonly onRequest: (req: RpcRequest) => Promise<RpcResponse>,
  ) {}

  start(): void {
    this.connect()
    chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 })
    chrome.alarms.onAlarm.addListener(a => {
      if (a.name === KEEPALIVE_ALARM) this.keepalive()
    })
  }

  isConnected(): boolean {
    return this.connected
  }

  /** The refusal details if the bridge rejected us as incompatible, else null. */
  getIncompatible(): Incompatible | null {
    return this.incompatible
  }

  private connect(): void {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return
    }
    let ws: WebSocket
    try {
      ws = new WebSocket(this.url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = ws

    ws.addEventListener('open', () => {
      this.connected = true
      this.backoff = 250
      // Fresh attempt: re-handshake. If still incompatible, the bridge resets this below.
      this.incompatible = null
      this.send({
        type: 'hello',
        extensionVersion: chrome.runtime.getManifest().version,
        protocolVersion: PROTOCOL_VERSION,
      })
      console.log('[monkeysee] connected to bridge')
    })
    ws.addEventListener('message', ev => void this.onMessage(ev.data))
    ws.addEventListener('close', () => {
      this.connected = false
      this.scheduleReconnect()
    })
    ws.addEventListener('error', () => {
      try {
        ws.close()
      } catch {
        // ignore
      }
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    let delay: number
    if (this.incompatible) {
      delay = INCOMPATIBLE_RETRY
    } else {
      delay = this.backoff
      this.backoff = Math.min(MAX_BACKOFF, this.backoff * 2)
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private keepalive(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.send({ type: 'ping' })
    } else {
      this.connect()
    }
  }

  private async onMessage(data: unknown): Promise<void> {
    let msg: unknown
    try {
      msg = JSON.parse(String(data))
    } catch {
      return
    }

    // Bridge -> SW control events (e.g. an incompatible-protocol refusal).
    if (msg && typeof msg === 'object' && 'type' in msg) {
      const ev = msg as BridgeEvent
      if (ev.type === 'incompatible') {
        this.incompatible = {
          bridgeProtocolVersion: ev.bridgeProtocolVersion,
          extensionProtocolVersion: ev.extensionProtocolVersion ?? PROTOCOL_VERSION,
        }
        console.error(
          `[monkeysee] bridge refused connection: protocol ${PROTOCOL_VERSION} is ` +
            `incompatible with bridge protocol ${ev.bridgeProtocolVersion}. Update whichever ` +
            'side is older. Will retry slowly.',
        )
      }
      return
    }

    const req = msg as RpcRequest
    if (!req || typeof req.id !== 'string' || typeof req.method !== 'string') return
    const res = await this.onRequest(req)
    this.send(res)
  }

  send(msg: unknown): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg))
    }
  }
}
