/** OMP RPC v2 receive framing; wire contract: upstream modes/rpc/rpc-frame.ts. */
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_MESSAGE_BYTES = 64 * MAX_FRAME_BYTES;
const MAX_CHUNK_BYTES = 256 * 1024;

interface PendingChunks {
  id: string;
  count: number;
  length: number;
  next: number;
  received: number;
  chunks: Buffer[];
}

export class OmpRpcFrameDecoder {
  private pending: PendingChunks | null = null;

  reset(): void {
    this.pending = null;
  }

  push(frame: Record<string, unknown>): Record<string, unknown> | null {
    try {
      return this.decode(frame);
    } catch (error) {
      this.reset();
      throw error;
    }
  }

  private decode(frame: Record<string, unknown>): Record<string, unknown> | null {
    if (frame.type === 'rpc_frame_error') throw new Error(String(frame.error ?? 'OMP RPC frame exceeded the transport limit'));
    if (frame.type !== 'rpc_chunk') {
      if (this.pending) throw new Error('OMP RPC chunk sequence interrupted');
      return frame;
    }
    const { chunkId, index, count, byteLength, data } = frame;
    if (typeof chunkId !== 'string' || !chunkId || chunkId.length > 128
      || typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0
      || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 2 || count > 256 || index >= count
      || typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength)
      || byteLength < MAX_FRAME_BYTES || byteLength > MAX_MESSAGE_BYTES) {
      throw new Error('Invalid OMP RPC chunk metadata');
    }
    if (typeof data !== 'string' || !data || data.length > Math.ceil(MAX_CHUNK_BYTES / 3) * 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
      throw new Error('Invalid OMP RPC chunk data');
    }
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > MAX_CHUNK_BYTES || bytes.toString('base64') !== data) {
      throw new Error('Invalid OMP RPC chunk payload');
    }
    if (!this.pending) {
      if (index !== 0) throw new Error('OMP RPC chunk sequence must start at zero');
      this.pending = { id: chunkId, count, length: byteLength, next: 0, received: 0, chunks: [] };
    }
    const pending = this.pending;
    if (pending.id !== chunkId || pending.count !== count || pending.length !== byteLength || pending.next !== index) {
      throw new Error('OMP RPC chunk sequence mismatch');
    }
    pending.received += bytes.length;
    if (pending.received > pending.length) throw new Error('OMP RPC chunks exceed declared length');
    pending.chunks.push(bytes);
    pending.next++;
    if (pending.next < pending.count) return null;
    if (pending.received !== pending.length) throw new Error('OMP RPC chunk length mismatch');
    this.pending = null;
    const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(pending.chunks)));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('OMP RPC frame must be an object');
    return decoded as Record<string, unknown>;
  }
}
