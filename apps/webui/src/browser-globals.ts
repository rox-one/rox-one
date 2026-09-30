import { Buffer } from 'buffer'
import process from 'process'

// Shared renderer modules use these globals even when running without Electron.
// Use the browser packages; server-only Node builtins remain unsupported.
const browserGlobals = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer
  global?: typeof globalThis
  process?: typeof process
}

browserGlobals.Buffer ??= Buffer
browserGlobals.global ??= globalThis
browserGlobals.process ??= process
