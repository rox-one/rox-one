/**
 * NativeRunProvider — CloudRunProvider adapter over craft-native `run:*` RPC.
 *
 * Same on-disk contract as LocalSubprocessProvider; process supervision lives
 * in the sidecar (`craft-rund`). Production `makeProvider` selects this
 * adapter when `cloudRuns.provider === 'native'` and
 * `CRAFT_FEATURE_NATIVE_SIDECAR=1` with a live sidecar.
 */
import type {
  ArtifactMeta,
  CloudRunProvider,
  RunEvent,
  RunHandle,
  RunSpec,
  RunStatus,
} from './types.ts';
import { CloudRunnerError } from './types.ts';

export interface NativeRunRpc {
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>;
}

export interface NativeRunProviderOptions {
  baseDir: string;
  rpc: NativeRunRpc;
  /** When omitted, the sidecar uses `craft-native --stub-run`. */
  runnerCommand?: string[];
  pollMs?: number;
}

const MAPPED_CODES = new Set([
  'not_found',
  'invalid_spec',
  'artifact_too_large',
  'path_traversal',
  'provider_error',
]);

export class NativeRunProvider implements CloudRunProvider {
  readonly providerId = 'native';
  readonly baseDir: string;
  private readonly rpc: NativeRunRpc;
  private readonly runnerCommand: string[] | undefined;
  private readonly pollMs: number;

  constructor(opts: NativeRunProviderOptions) {
    this.baseDir = opts.baseDir;
    this.rpc = opts.rpc;
    this.runnerCommand = opts.runnerCommand;
    this.pollMs = opts.pollMs ?? 100;
  }

  async createRun(spec: RunSpec): Promise<RunHandle> {
    return this.invokeMapped<RunHandle>(
      'run:create',
      this.baseDir,
      spec,
      this.runnerCommand ? { runnerCommand: this.runnerCommand } : {},
    );
  }

  async getStatus(id: string): Promise<RunStatus> {
    return this.invokeMapped<RunStatus>('run:status', this.baseDir, id);
  }

  async cancel(id: string): Promise<void> {
    await this.invokeMapped<{ ok: boolean }>('run:cancel', this.baseDir, id);
  }

  async listArtifacts(id: string): Promise<ArtifactMeta[]> {
    return this.invokeMapped<ArtifactMeta[]>('run:listArtifacts', this.baseDir, id);
  }

  async fetchArtifact(id: string, path: string): Promise<Uint8Array> {
    const result = await this.invokeMapped<{ base64: string; size: number }>(
      'run:fetchArtifact',
      this.baseDir,
      id,
      path,
    );
    const buf = Buffer.from(result.base64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  async *subscribeEvents(id: string): AsyncIterable<RunEvent> {
    let offset = 0;
    for (;;) {
      const page = await this.invokeMapped<{
        events: RunEvent[];
        nextOffset: number;
        terminal: boolean;
      }>('run:events', this.baseDir, id, offset);
      offset = page.nextOffset;
      for (const event of page.events) {
        yield event;
      }
      if (page.terminal) return;
      const { promise, resolve: wake } = Promise.withResolvers<void>();
      setTimeout(wake, this.pollMs);
      await promise;
    }
  }

  private async invokeMapped<T>(channel: string, ...args: unknown[]): Promise<T> {
    try {
      return await this.rpc.invoke<T>(channel, ...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code =
        error !== null && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
      if (MAPPED_CODES.has(code)) {
        throw new CloudRunnerError(
          message,
          code as 'not_found' | 'invalid_spec' | 'artifact_too_large' | 'path_traversal' | 'provider_error',
        );
      }
      throw new CloudRunnerError(message, 'provider_error', { cause: error });
    }
  }
}
