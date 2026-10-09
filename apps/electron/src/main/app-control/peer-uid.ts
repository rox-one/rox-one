/**
 * Peer-UID verification for app-control sockets (port row e2.7).
 *
 * The check is fail-closed: a socket whose peer UID cannot be determined is
 * treated as a mismatch by the server. The platform implementation uses
 * `getpeereid` on darwin and `SO_PEERCRED` on linux through `bun:ffi`; the
 * reader is injectable so the protocol logic is testable without native code.
 */

import { createRequire } from 'node:module'
import type { Socket } from 'node:net'

/** Returns the peer's effective UID, or `null` when it cannot be determined. */
export type PeerUidReader = (socket: Socket) => number | null

/** DI seam for "this platform cannot report peer credentials". */
export const unsupportedPeerUidReader: PeerUidReader = () => null

interface BunFfi {
  dlopen(path: string, symbols: Record<string, { args: readonly string[]; returns: string }>): {
    symbols: Record<string, (...args: unknown[]) => number>
  }
  ptr(buffer: Buffer): number
}

const requireModule = createRequire(import.meta.url)
let cachedReader: PeerUidReader | null | undefined

/**
 * Build the native reader, or `null` when `bun:ffi`/the syscall is unavailable
 * (e.g. under Electron's Node, which has no FFI). The reader reads the socket's
 * file descriptor, so it only works when the runtime exposes `_handle.fd`.
 */
export function createNativePeerUidReader(): PeerUidReader | null {
  if (cachedReader !== undefined) return cachedReader
  cachedReader = buildNativeReader()
  return cachedReader
}

function buildNativeReader(): PeerUidReader | null {
  let ffi: BunFfi
  try {
    ffi = requireModule('bun:ffi') as BunFfi
  } catch {
    return null
  }
  try {
    if (process.platform === 'darwin') {
      const lib = ffi.dlopen('/usr/lib/libSystem.B.dylib', {
        getpeereid: { args: ['int', 'ptr', 'ptr'], returns: 'int' },
      })
      return (socket) => {
        const fd = socketFileDescriptor(socket)
        if (fd === null) return null
        const euid = Buffer.alloc(4)
        const egid = Buffer.alloc(4)
        if (lib.symbols.getpeereid(fd, ffi.ptr(euid), ffi.ptr(egid)) !== 0) return null
        return euid.readUInt32LE(0)
      }
    }
    if (process.platform === 'linux') {
      const lib = ffi.dlopen('libc.so.6', {
        getsockopt: { args: ['int', 'int', 'int', 'ptr', 'ptr'], returns: 'int' },
      })
      return (socket) => {
        const fd = socketFileDescriptor(socket)
        if (fd === null) return null
        const ucred = Buffer.alloc(12)
        const length = Buffer.alloc(4)
        length.writeUInt32LE(12, 0)
        // SOL_SOCKET = 1, SO_PEERCRED = 17.
        if (lib.symbols.getsockopt(fd, 1, 17, ffi.ptr(ucred), ffi.ptr(length)) !== 0) return null
        return ucred.readUInt32LE(4)
      }
    }
    return null
  } catch {
    return null
  }
}

/** Default reader: the native one when available, otherwise fail-closed. */
export function defaultPeerUidReader(): PeerUidReader {
  return createNativePeerUidReader() ?? unsupportedPeerUidReader
}

function socketFileDescriptor(socket: Socket): number | null {
  const handle = '_handle' in socket ? socket._handle : undefined
  if (typeof handle !== 'object' || handle === null) return null
  return 'fd' in handle && typeof handle.fd === 'number' ? handle.fd : null
}