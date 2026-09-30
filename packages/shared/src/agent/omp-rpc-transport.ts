/** Managed OMP 17.2.10 RPC limits; protocol v2 changes framing, not these limits. */
export const OMP_RPC_MAX_FRAME_BYTES = 1024 * 1024;
export const OMP_RPC_MAX_REASSEMBLED_BYTES = 64 * 1024 * 1024;
export const OMP_RPC_CHUNK_BYTES = 256 * 1024;

type RpcObject = Record<string, unknown>;
interface PendingChunks {
  id: string;
  count: number;
  length: number;
  next: number;
  received: number;
  chunks: Buffer[];
}
const isObject = (value: unknown): value is RpcObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Match the managed client's capability gate; older ready frames remain v1. */
export function supportsOmpRpcV2(ready: RpcObject): boolean {
  return Array.isArray(ready.supportedProtocolVersions) && ready.supportedProtocolVersions.includes(2)
    && ready.maxFrameBytes === OMP_RPC_MAX_FRAME_BYTES
    && ready.maxReassembledFrameBytes === OMP_RPC_MAX_REASSEMBLED_BYTES;
}

/** Check raw stdout before readline buffers an unterminated physical frame. */
export class OmpRpcLineGuard {
  private bytes = 0;
  accept(data: Uint8Array): void {
    for (const byte of data) {
      this.bytes++;
      if (this.bytes > OMP_RPC_MAX_FRAME_BYTES || (byte !== 10 && this.bytes === OMP_RPC_MAX_FRAME_BYTES)) {
        throw new Error('OMP RPC physical frame exceeds the transport limit');
      }
      if (byte === 10) this.bytes = 0;
    }
  }
}

/** One transport per child. No partial logical frame reaches command/event handlers. */
export class OmpRpcTransport {
  private version: 1 | 2 = 1;
  private pending?: PendingChunks;
  private chunkCounter = 0;

  enableV2(): void { this.version = 2; }

  reset(): void {
    this.version = 1;
    this.pending = undefined;
    this.chunkCounter = 0;
  }

  finish(): void {
    if (!this.pending) return;
    this.pending = undefined;
    throw new Error('OMP RPC chunk sequence was truncated');
  }

  decodeLine(line: string): RpcObject | undefined {
    try {
      if (Buffer.byteLength(line, 'utf8') + 1 > OMP_RPC_MAX_FRAME_BYTES) {
        throw new Error('OMP RPC physical frame exceeds the transport limit');
      }
      let value: unknown;
      try { value = JSON.parse(line); } catch {
        if (this.pending) throw new Error('OMP RPC chunk sequence interrupted by invalid JSON');
        // Older wrappers can print startup banners before the JSONL ready frame.
        return undefined;
      }
      if (!isObject(value)) throw new Error('OMP RPC frame must be an object');
      if (value.type !== 'rpc_chunk') {
        if (this.pending) throw new Error('OMP RPC chunk sequence interrupted');
        return value;
      }
      if (this.version !== 2) throw new Error('OMP RPC chunk arrived before protocol v2 acknowledgement');
      const { chunkId, index, count, byteLength, data } = value;
      if (typeof chunkId !== 'string' || chunkId.length === 0 || chunkId.length > 128
        || !Number.isSafeInteger(index) || !Number.isSafeInteger(count) || !Number.isSafeInteger(byteLength)
        || (index as number) < 0 || (count as number) < 2
        || (count as number) > Math.ceil(OMP_RPC_MAX_REASSEMBLED_BYTES / OMP_RPC_CHUNK_BYTES)
        || (index as number) >= (count as number) || (byteLength as number) < OMP_RPC_MAX_FRAME_BYTES
        || (byteLength as number) > OMP_RPC_MAX_REASSEMBLED_BYTES) {
        throw new Error('OMP RPC invalid chunk metadata');
      }
      if (typeof data !== 'string' || data.length === 0
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
        throw new Error('OMP RPC invalid chunk base64');
      }
      const bytes = Buffer.from(data, 'base64');
      if (bytes.toString('base64') !== data) throw new Error('OMP RPC noncanonical chunk base64');
      if (bytes.byteLength > OMP_RPC_CHUNK_BYTES) throw new Error('OMP RPC chunk payload exceeds the transport limit');
      if (!this.pending) {
        if (index !== 0) throw new Error('OMP RPC chunk sequence must start at index 0');
        this.pending = { id: chunkId, count: count as number, length: byteLength as number, next: 0, received: 0, chunks: [] };
      }
      const p = this.pending;
      if (p.id !== chunkId || p.count !== count || p.length !== byteLength || p.next !== index) {
        throw new Error('OMP RPC chunk sequence mismatch');
      }
      if (p.received + bytes.byteLength > p.length) throw new Error('OMP RPC chunks exceed the declared length');
      p.chunks.push(bytes);
      p.received += bytes.byteLength;
      p.next++;
      if (p.next < p.count) return undefined;
      if (p.received !== p.length) throw new Error('OMP RPC chunk sequence length mismatch');
      this.pending = undefined;
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(p.chunks));
      const frame: unknown = JSON.parse(decoded);
      if (!isObject(frame)) throw new Error('OMP RPC logical frame must be an object');
      return frame;
    } catch (error) {
      this.pending = undefined;
      throw error;
    }
  }

  *encodeFrames(message: RpcObject): Generator<string> {
    const json = JSON.stringify(message);
    const byteLength = Buffer.byteLength(json, 'utf8');
    if (byteLength + 1 <= OMP_RPC_MAX_FRAME_BYTES) { yield json + '\n'; return; }
    if (this.version !== 2) throw new Error('OMP RPC command exceeds the protocol v1 frame limit');
    if (byteLength > OMP_RPC_MAX_REASSEMBLED_BYTES) throw new Error('OMP RPC command exceeds the reassembly limit');
    const bytes = Buffer.from(json, 'utf8');
    const count = Math.ceil(byteLength / OMP_RPC_CHUNK_BYTES);
    const chunkId = 'rox-rpc-' + (++this.chunkCounter);
    for (let index = 0; index < count; index++) {
      yield JSON.stringify({ type: 'rpc_chunk', chunkId, index, count, byteLength,
        data: bytes.subarray(index * OMP_RPC_CHUNK_BYTES, (index + 1) * OMP_RPC_CHUNK_BYTES).toString('base64') }) + '\n';
    }
  }
}
