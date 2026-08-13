/** Length-prefixed JSON frames for the craft-native Unix socket. */

export const MAX_FRAME_BYTES = 16 * 1024 * 1024

export function encodeFrame(payload: string | Buffer): Buffer {
  const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload
  if (body.length > MAX_FRAME_BYTES) {
    throw new Error(`native frame too large: ${body.length}`)
  }
  const header = Buffer.alloc(4)
  header.writeUInt32BE(body.length)
  return Buffer.concat([header, body])
}

export class FrameDecoder {
  private buf = Buffer.alloc(0)

  constructor(private readonly maxBytes = MAX_FRAME_BYTES) {}

  push(chunk: Buffer): string[] {
    this.buf = this.buf.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buf, chunk])
    const out: string[] = []
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0)
      if (len > this.maxBytes) {
        throw new Error(`native frame too large: ${len}`)
      }
      if (this.buf.length < 4 + len) break
      const payload = this.buf.subarray(4, 4 + len).toString('utf8')
      this.buf = Buffer.from(this.buf.subarray(4 + len))
      out.push(payload)
    }
    return out
  }
}
