import { describe, expect, it } from 'bun:test';
import { OmpRpcLineGuard, OmpRpcTransport, supportsOmpRpcV2, OMP_RPC_CHUNK_BYTES, OMP_RPC_MAX_FRAME_BYTES, OMP_RPC_MAX_REASSEMBLED_BYTES } from '../omp-rpc-transport.ts';

const large = { type: 'response', id: 'qa-catalog', command: 'get_available_models', success: true,
  data: { models: [{ provider: 'rox', id: 'standard', name: 'x'.repeat(1_424_866) }] } };
function frames(value: Record<string, unknown> = large): Record<string, unknown>[] {
  const sender = new OmpRpcTransport(); sender.enableV2();
  return [...sender.encodeFrames(value)].map(line => JSON.parse(line));
}
function decoder() { const transport = new OmpRpcTransport(); transport.enableV2(); return transport; }
const line = (value: unknown) => JSON.stringify(value);

describe('OMP bounded protocol v2 framing', () => {
  it('accepts exactly 1 MiB including newline and requires v2 for the next byte', () => {
    const overhead = Buffer.byteLength(JSON.stringify({ type: 'prompt', message: '' })) + 1;
    const exact = { type: 'prompt', message: 'x'.repeat(OMP_RPC_MAX_FRAME_BYTES - overhead) };
    const v1 = new OmpRpcTransport();
    const encoded = [...v1.encodeFrames(exact)];
    expect(encoded).toHaveLength(1);
    expect(Buffer.byteLength(encoded[0]!)).toBe(OMP_RPC_MAX_FRAME_BYTES);
    expect(v1.decodeLine(encoded[0]!.slice(0, -1))).toEqual(exact);
    const larger = { ...exact, message: exact.message + 'x' };
    expect(() => [...v1.encodeFrames(larger)]).toThrow('protocol v1');
    const v2 = decoder(); let result;
    for (const chunk of frames(larger)) result = v2.decodeLine(line(chunk));
    expect(result).toEqual(larger);
  });
  it('bounds unterminated stdout before readline and handles frame boundaries across stream chunks', () => {
    const guard = new OmpRpcLineGuard();
    guard.accept(Buffer.alloc(OMP_RPC_MAX_FRAME_BYTES - 2, 120));
    guard.accept(Buffer.from('x\n'));
    guard.accept(Buffer.from('{}\n{}\n'));
    guard.accept(Buffer.alloc(OMP_RPC_MAX_FRAME_BYTES - 1, 120));
    expect(() => guard.accept(Buffer.from('x'))).toThrow('physical frame');
    expect(() => new OmpRpcLineGuard().accept(Buffer.alloc(OMP_RPC_MAX_FRAME_BYTES, 120))).toThrow('physical frame');
  });
  it('negotiates only the exact managed advertised bounds and retains older ready frames on v1', () => {
    const ready = { supportedProtocolVersions: [1, 2], maxFrameBytes: OMP_RPC_MAX_FRAME_BYTES, maxReassembledFrameBytes: OMP_RPC_MAX_REASSEMBLED_BYTES };
    expect(supportsOmpRpcV2(ready)).toBe(true);
    for (const patch of [{ supportedProtocolVersions: [1] }, { supportedProtocolVersions: undefined },
      { maxFrameBytes: undefined }, { maxFrameBytes: 2097152 }, { maxReassembledFrameBytes: undefined }, { maxReassembledFrameBytes: 67108865 }]) {
      expect(supportsOmpRpcV2({ ...ready, ...patch })).toBe(false);
    }
  });
  it('matches native constants and returns a large logical response only at its last chunk', () => {
    expect([OMP_RPC_MAX_FRAME_BYTES, OMP_RPC_MAX_REASSEMBLED_BYTES, OMP_RPC_CHUNK_BYTES]).toEqual([1048576, 67108864, 262144]);
    const chunks = frames(); const receiver = decoder();
    expect(Buffer.byteLength(line(large))).toBeGreaterThan(1_424_866);
    for (const chunk of chunks.slice(0, -1)) expect(receiver.decodeLine(line(chunk))).toBeUndefined();
    expect(receiver.decodeLine(line(chunks.at(-1)))).toEqual(large);
    expect(() => receiver.finish()).not.toThrow();
    for (const chunk of chunks) expect(Buffer.byteLength(line(chunk)) + 1).toBeLessThanOrEqual(OMP_RPC_MAX_FRAME_BYTES);
  });

  it('reassembles UTF-8 even when a chunk boundary splits a code point', () => {
    const value = { type: 'prompt', id: 'qa-unicode', message: '🙂Я'.repeat(200_000) };
    const receiver = decoder(); let result;
    for (const chunk of frames(value)) result = receiver.decodeLine(line(chunk));
    expect(result).toEqual(value);
  });

  it('round trips small frames on v1, ignores legacy non-JSON banners and rejects unnegotiated chunks', () => {
    const transport = new OmpRpcTransport(); const value = { type: 'get_state', id: 'qa' };
    expect([...transport.encodeFrames(value)]).toEqual([line(value) + '\n']);
    expect(transport.decodeLine(line(value))).toEqual(value);
    expect(transport.decodeLine('OMP startup banner')).toBeUndefined();
    expect(() => transport.decodeLine(line(frames()[0]))).toThrow('before protocol v2');
    expect(() => [...transport.encodeFrames(large)]).toThrow('protocol v1');
  });

  for (const [name, patch] of [
    ['negative index', { index: -1 }], ['noninteger index', { index: 0.5 }],
    ['zero count', { count: 0 }], ['count over ceiling', { count: 257 }],
    ['declaration over ceiling', { byteLength: 67108865 }], ['declaration below frame limit', { byteLength: 1024 }],
    ['empty id', { chunkId: '' }], ['long id', { chunkId: 'x'.repeat(129) }],
    ['invalid base64', { data: '%%%' }], ['noncanonical base64', { data: 'AB==' }],
    ['empty base64', { data: '' }], ['oversized payload', { data: Buffer.alloc(OMP_RPC_CHUNK_BYTES + 1).toString('base64') }],
  ] as const) {
    it(`rejects ${name} before any logical delivery`, () => {
      expect(() => decoder().decodeLine(line({ ...frames()[0], ...patch }))).toThrow();
    });
  }

  for (const [name, patch] of [['out of order', { index: 2 }], ['duplicate', { index: 0 }],
    ['different id', { chunkId: 'other' }], ['different count', { count: 8 }],
    ['different declared length', { byteLength: 1_900_000 }]] as const) {
    it(`rejects an ${name} sequence and clears unfinished memory`, () => {
      const chunks = frames(); const receiver = decoder();
      expect(receiver.decodeLine(line(chunks[0]))).toBeUndefined();
      expect(() => receiver.decodeLine(line({ ...chunks[1], ...patch }))).toThrow();
      expect(() => receiver.finish()).not.toThrow();
      expect(receiver.decodeLine(line({ type: 'response', success: true }))).toEqual({ type: 'response', success: true });
    });
  }

  for (const interruption of [{ type: 'response', id: 'other', success: true }, 'not JSON']) {
    it('rejects an interrupted sequence instead of resolving a different command', () => {
      const receiver = decoder(); receiver.decodeLine(line(frames()[0]));
      expect(() => receiver.decodeLine(typeof interruption === 'string' ? interruption : line(interruption))).toThrow('interrupted');
    });
  }

  it('rejects truncated EOF and resets protocol/assembly for a new child', () => {
    const receiver = decoder(); receiver.decodeLine(line(frames()[0]));
    expect(() => receiver.finish()).toThrow('truncated');
    expect(() => receiver.finish()).not.toThrow();
    receiver.decodeLine(line(frames()[0])); receiver.reset();
    expect(() => receiver.finish()).not.toThrow();
    expect(() => receiver.decodeLine(line(frames()[0]))).toThrow('before protocol v2');
    receiver.enableV2(); let result;
    for (const chunk of frames()) result = receiver.decodeLine(line(chunk));
    expect(result).toEqual(large);
  });

  it('rejects a final total that disagrees with the declaration', () => {
    const chunks = frames(); const receiver = decoder(); let error;
    try { for (const chunk of chunks) receiver.decodeLine(line({ ...chunk, byteLength: (chunk.byteLength as number) + 1 })); } catch (caught) { error = caught; }
    expect(String(error)).toContain('length mismatch');
  });

  for (const [name, bytes] of [['invalid UTF-8', Buffer.alloc(OMP_RPC_MAX_FRAME_BYTES, 0xff)],
    ['invalid logical JSON', Buffer.alloc(OMP_RPC_MAX_FRAME_BYTES, 0x78)],
    ['nonobject logical JSON', Buffer.from(JSON.stringify('x'.repeat(OMP_RPC_MAX_FRAME_BYTES)))]] as const) {
    it(`rejects ${name} after complete reassembly`, () => {
      const receiver = decoder(); const count = Math.ceil(bytes.length / OMP_RPC_CHUNK_BYTES);
      expect(() => {
        for (let index = 0; index < count; index++) receiver.decodeLine(line({ type: 'rpc_chunk', chunkId: 'qa', index,
          count, byteLength: bytes.length, data: bytes.subarray(index * OMP_RPC_CHUNK_BYTES, (index + 1) * OMP_RPC_CHUNK_BYTES).toString('base64') }));
      }).toThrow();
    });
  }

  it('rejects oversized physical JSONL and logical outbound messages', () => {
    expect(() => decoder().decodeLine('x'.repeat(OMP_RPC_MAX_FRAME_BYTES))).toThrow('physical frame');
    expect(() => [...decoder().encodeFrames({ type: 'prompt', message: 'x'.repeat(OMP_RPC_MAX_REASSEMBLED_BYTES) })]).toThrow('reassembly limit');
  });
});
