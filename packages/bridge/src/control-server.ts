import { WebSocketServer, type WebSocket } from 'ws'
import { PROTOCOL_VERSION, isProtocolCompatible } from 'monkeysee-protocol'
import type { BridgeEvent, RpcRequest, RpcResponse } from 'monkeysee-protocol'
import { RpcCallError, type WsServer } from './ws-server'

/**
 * Leader-only relay. Binds the control port and forwards each follower's RpcRequest to the
 * extension via the live `WsServer`, threading the follower-resolved `tabId` straight
 * through. The relay holds NO per-session tab state — the follower already injected its
 * `currentTabId` before the request left its process.
 *
 * Returns once listening; rejects on `error` (notably `EADDRINUSE`) so the leader can
 * release the extension port and re-run election rather than ever run two leaders.
 */
export function startControlServer(
  ws: WsServer,
  port: number,
  host = '127.0.0.1',
): Promise<{ close(): void }> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host, port })
    const onError = (err: Error) => {
      wss.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      wss.off('error', onError)
      wss.on('error', err => console.error('[monkeysee] control server error', err))
      wss.on('connection', socket => onFollower(socket, ws))
      console.error(`[monkeysee] control listening on ${host}:${port}`)
      resolve({ close: () => wss.close() })
    }
    wss.once('error', onError)
    wss.once('listening', onListening)
  })
}

function send(socket: WebSocket, msg: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
}

function onFollower(socket: WebSocket, ws: WsServer): void {
  let helloOk = false
  console.error('[monkeysee] follower connected')

  socket.on('message', data => void onMessage(data.toString()))
  socket.on('close', () => console.error('[monkeysee] follower disconnected'))
  socket.on('error', err => console.error('[monkeysee] follower socket error', err))

  async function onMessage(raw: string): Promise<void> {
    let msg: unknown
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    // Handshake: refuse a follower whose protocol major does not match ours.
    if (msg && typeof msg === 'object' && 'type' in msg) {
      const ev = msg as { type: string; protocolVersion?: string }
      if (ev.type === 'hello') {
        const remote = ev.protocolVersion ?? 'unknown'
        if (!isProtocolCompatible(remote, PROTOCOL_VERSION)) {
          const refusal: BridgeEvent = {
            type: 'incompatible',
            bridgeProtocolVersion: PROTOCOL_VERSION,
            extensionProtocolVersion: remote,
          }
          send(socket, refusal)
          try {
            socket.close(4001, 'protocol-incompatible')
          } catch {
            // socket may already be closing
          }
          return
        }
        helloOk = true
      }
      return
    }

    // Relay an RpcRequest to the extension. The follower already resolved `tabId`.
    const req = msg as RpcRequest
    if (!req || typeof req.id !== 'string' || typeof req.method !== 'string') return
    if (!helloOk) return
    let res: RpcResponse
    try {
      const result = await ws.call(req.method, req.params, { tabId: req.tabId })
      res = { id: req.id, ok: true, result }
    } catch (e) {
      const error =
        e instanceof RpcCallError
          ? e.rpc
          : { code: 'internal' as const, message: e instanceof Error ? e.message : String(e) }
      res = { id: req.id, ok: false, error }
    }
    send(socket, res)
  }
}
