export interface PtyHandle {
  pid: number
  write(data: Uint8Array): void
  resize(cols: number, rows: number): void
  kill(): void
}

export function createPty(_cols: number, _rows: number): PtyHandle {
  throw new Error('PTY not implemented until native-crate lands (G1 chosen: native-crate)')
}
