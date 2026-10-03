import { OmpRpcTransport } from './omp-rpc-transport.ts';

/** Object-frame compatibility API for an already negotiated v2 peer.
 * Production OmpAgent retains its raw-line guard and acknowledgement gate.
 * Both entry points use the same bounds, chunk validation and error cleanup. */
export class OmpRpcFrameDecoder {
  private readonly transport = new OmpRpcTransport();

  constructor() { this.reset(); }

  reset(): void {
    this.transport.reset();
    this.transport.enableV2();
  }

  push(frame: Record<string, unknown>): Record<string, unknown> | null {
    const decoded = this.transport.decodeLine(JSON.stringify(frame));
    if (!decoded) return null;
    // Ordinary object frames preserve the public API's reference identity.
    return frame.type === 'rpc_chunk' ? decoded : frame;
  }
}
