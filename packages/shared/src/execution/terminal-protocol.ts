export type TerminalFrameKind = 'out' | 'in' | 'resize' | 'snapshot'

export interface TerminalFrame {
  seq: number
  epoch: number
  kind: TerminalFrameKind
  payload: Uint8Array
}

export type TerminalControl =
  | { op: 'create'; sessionId?: string; cwd?: string }
  | { op: 'attach'; terminalId: string; epoch: number }
  | { op: 'detach'; terminalId: string; epoch: number }
  | { op: 'destroy'; terminalId: string; epoch: number }
  | { op: 'resize'; terminalId: string; epoch: number; cols: number; rows: number }
  | { op: 'signal'; terminalId: string; epoch: number; name: 'INT' | 'TERM' | 'KILL' }
  | { op: 'snapshot'; terminalId: string; epoch: number }
  | { op: 'take_control'; terminalId: string; epoch: number }

export type TerminalControlOk =
  | { terminalId: string; epoch: number }
  | { terminalId: string; epoch: number; cols: number; rows: number }

export type TerminalControlErr =
  | { code: 'FENCE_MISMATCH'; epoch: number }
  | { code: 'NOT_FOUND' }
  | { code: 'FLAG_OFF' }
  | { code: 'HOST_UNSUPPORTED' }
  | { code: 'UNSUPPORTED' }
