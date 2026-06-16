export * from './state.js'
export * from './rpc.js'
export * from './tools.js'

/**
 * Wire-compatibility contract between a bridge and an extension.
 * Exchanged in the `hello` handshake; mismatched majors should be refused.
 */
export const PROTOCOL_VERSION = '0.0.1'
