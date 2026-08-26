export type PtyOption = 'craft-exec-extended' | 'native-crate' | 'node-pty' | 'multiplexer'

export const PTY_OPTIONS: readonly PtyOption[] = [
  'craft-exec-extended',
  'native-crate',
  'node-pty',
  'multiplexer',
] as const

export interface Probe {
  spawn: (cols: number, rows: number) => { pid: number; kill: () => void }
  write: (d: Uint8Array) => void
}

export interface PtyDecision {
  chosen: PtyOption
  rejected: PtyOption[]
  reason: string
  risk: string
}

const NOT_IMPLEMENTED = 'not implemented in spike until run'

export function probeCraftExec(): Probe {
  throw new Error(NOT_IMPLEMENTED)
}

export function probeNativeCrate(): Probe {
  throw new Error(NOT_IMPLEMENTED)
}

export function probeNodePty(): Probe {
  throw new Error(NOT_IMPLEMENTED)
}

export function probeMultiplexer(): Probe {
  throw new Error(NOT_IMPLEMENTED)
}

/** Negative gate: PTY bytes must not fit JSON-RPC serializeEnvelope payloads. */
export function ptyBytesFitInRpcEnvelope(): boolean {
  return false
}

export function choosePty(): PtyDecision {
  return {
    chosen: 'native-crate',
    rejected: ['craft-exec-extended', 'node-pty', 'multiplexer'],
    reason:
      'snapshot barrier + credit framing easiest next to transport/server.ts without touching codec.ts',
    risk:
      'new crate ownership; D2 restore stays explicit unsupported until later; must keep bytes off WsRpcServer',
  }
}

if (import.meta.main) {
  throw new Error(NOT_IMPLEMENTED)
}
