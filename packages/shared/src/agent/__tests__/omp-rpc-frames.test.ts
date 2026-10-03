import { describe, expect, it } from 'bun:test';
import { OmpRpcFrameDecoder } from '../omp-rpc-frames.ts';

function chunks(value: unknown): Record<string, unknown>[] {
  const bytes = Buffer.from(JSON.stringify(value));
  const size = 256 * 1024;
  const count = Math.ceil(bytes.length / size);
  return Array.from({ length: count }, (_, index) => ({
    type: 'rpc_chunk', chunkId: 'large-catalog', index, count, byteLength: bytes.length,
    data: bytes.subarray(index * size, (index + 1) * size).toString('base64'),
  }));
}

const LARGE_FRAME = {
  type: 'response', id: 'models', command: 'get_available_models', success: true,
  data: { models: [{ provider: 'rox', id: 'standard', name: 'Модель 🦊'.repeat(100_000) }] },
};

describe('OMP RPC v2 receive framing', () => {
  it('reassembles a catalog over 1 MiB, including UTF-8 split across chunk boundaries', () => {
    const decoder = new OmpRpcFrameDecoder();
    const frames = chunks(LARGE_FRAME);
    for (const frame of frames.slice(0, -1)) expect(decoder.push(frame)).toBeNull();
    expect(decoder.push(frames.at(-1)!)).toEqual(LARGE_FRAME);
    const regular = { type: 'ready', protocolVersion: 1 };
    expect(decoder.push(regular)).toBe(regular);
  });

  it('rejects out-of-order, interrupted and mismatched sequences and discards partial data', () => {
    const frames = chunks(LARGE_FRAME);
    for (const invalid of [frames[1]!, { ...frames[0], byteLength: 64 * 1024 * 1024 + 1 },
      { ...frames[0], data: 'invalid!' }, { ...frames[0], count: 257 }]) {
      expect(() => new OmpRpcFrameDecoder().push(invalid)).toThrow();
    }
    const decoder = new OmpRpcFrameDecoder();
    decoder.push(frames[0]!);
    expect(() => decoder.push({ type: 'response' })).toThrow('interrupted');
    decoder.push(frames[0]!);
    expect(() => decoder.push({ ...frames[1], chunkId: 'different' })).toThrow('mismatch');
    decoder.push(frames[0]!);
    decoder.reset();
    expect(decoder.push({ type: 'ready' })).toEqual({ type: 'ready' });
  });

  it('rejects payloads whose assembled length differs from the declared size', () => {
    const decoder = new OmpRpcFrameDecoder();
    const frames = chunks(LARGE_FRAME).map(frame => ({ ...frame, byteLength: Number(frame.byteLength) + 1 }));
    for (const frame of frames.slice(0, -1)) decoder.push(frame);
    expect(() => decoder.push(frames.at(-1)!)).toThrow('length mismatch');
    expect(() => decoder.push({ type: 'rpc_frame_error', error: 'transport overflow' })).toThrow('transport overflow');
  });
});
