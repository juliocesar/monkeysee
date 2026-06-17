---
'@monkeysee/protocol': minor
'@monkeysee/bridge': minor
'extension': minor
---

Enforce protocol compatibility on connect. The bridge now compares the extension's
`protocolVersion` (sent in the `hello` handshake) against its own and refuses any mismatched
**major** — it sends a `BridgeEvent` `{ type: 'incompatible', … }`, drops the socket, and
never serves RPCs across the gap. The extension surfaces the refusal in the popup and retries
slowly (30s) instead of reconnect-storming. Protocol adds `isProtocolCompatible` and the
`BridgeEvent` type. Pre-1.0 both sides are major 0, so this only bites across a future
breaking bump.
