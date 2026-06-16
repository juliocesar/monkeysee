import type { RpcRequest, RpcResponse } from '@monkeysee/protocol'
import { PROTOCOL_VERSION } from '@monkeysee/protocol'

const KEEPALIVE_ALARM = 'monkeysee-keepalive'
const MAX_BACKOFF = 5_000

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
    const delay = this.backoff
    this.backoff = Math.min(MAX_BACKOFF, this.backoff * 2)
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
    let req: RpcRequest
    try {
      req = JSON.parse(String(data)) as RpcRequest
    } catch {
      return
    }
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
