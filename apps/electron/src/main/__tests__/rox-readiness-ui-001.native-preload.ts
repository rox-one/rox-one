import { mock } from 'bun:test'

// The real protocol parser and navigation sink run in Bun with synthetic
// windows/transport. Logging does not require an installed Electron runtime.
mock.module(new URL('../logger.ts', import.meta.url).pathname, () => ({
  mainLog: { info() {}, warn() {}, error() {}, debug() {} },
}))

// Negative control loads the exact previous source with only import paths
// adjusted, allowing the same behavioral assertions to prove the regression.
if (process.env.ROX_UI001_NATIVE_SOURCE) {
  const original = await import(process.env.ROX_UI001_NATIVE_SOURCE)
  mock.module(new URL('../deep-link.ts', import.meta.url).pathname, () => original)
}
