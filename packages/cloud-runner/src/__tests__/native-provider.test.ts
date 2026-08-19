import { describe, expect, test } from 'bun:test';
import { CloudRunnerError } from '../types.ts';
import { NativeRunProvider } from '../native-provider.ts';

describe('NativeRunProvider error mapping', () => {
  test('maps sidecar path_traversal onto CloudRunnerError', async () => {
    const provider = new NativeRunProvider({
      baseDir: '/tmp/runs',
      rpc: {
        invoke: async () => {
          throw Object.assign(new Error('unsafe artifact path: ../spec.json'), {
            code: 'path_traversal',
          });
        },
      },
    });
    try {
      await provider.fetchArtifact('run-1', '../spec.json');
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CloudRunnerError);
      expect((error as CloudRunnerError).code).toBe('path_traversal');
    }
  });

  test('maps unknown sidecar failures to provider_error', async () => {
    const provider = new NativeRunProvider({
      baseDir: '/tmp/runs',
      rpc: {
        invoke: async () => {
          throw Object.assign(new Error('boom'), { code: 'HANDLER_ERROR' });
        },
      },
    });
    try {
      await provider.getStatus('run-1');
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CloudRunnerError);
      expect((error as CloudRunnerError).code).toBe('provider_error');
    }
  });
});
