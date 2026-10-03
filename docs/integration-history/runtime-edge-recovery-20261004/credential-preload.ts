import { mock } from 'bun:test'
// Isolated test process: force unavailable synthetic providers, never open or
// write the user's Keychain/Secret Service or read hardware inventory.
mock.module('child_process', () => ({
  execSync: () => { throw new Error('test-only machine inventory unavailable') },
  spawnSync: () => ({ status: 1, stdout: '', stderr: 'test-only provider unavailable' }),
}))
