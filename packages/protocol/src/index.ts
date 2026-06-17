export * from './state.js'
export * from './rpc.js'
export * from './tools.js'

/**
 * Wire-compatibility contract between a bridge and an extension.
 * Exchanged in the `hello` handshake; mismatched majors should be refused.
 */
export const PROTOCOL_VERSION = '0.0.1'

/** Major component of an `x.y.z` version string, or null if it cannot be parsed. */
function protocolMajor(version: string): number | null {
  const m = /^\s*(\d+)\./.exec(version)
  return m && m[1] !== undefined ? Number(m[1]) : null
}

/**
 * Two protocol versions are compatible iff they share a major version. (Pre-1.0 both
 * sides are major 0 and move in lockstep via the workspace.) An unparseable version is
 * treated as incompatible — better to refuse than to serve RPCs across an unknown gap.
 */
export function isProtocolCompatible(a: string, b: string): boolean {
  const ma = protocolMajor(a)
  const mb = protocolMajor(b)
  return ma !== null && ma === mb
}
