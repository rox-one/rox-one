import { mock } from 'bun:test'
import { resolve } from 'node:path'
// Only the native logger is a declared substitute; parseDeepLink/handleDeepLink remain actual.
const silent = { debug() {}, info() {}, warn() {}, error() {} }
mock.module(resolve(process.cwd(), 'apps/electron/src/main/logger.ts'), () => ({ mainLog: silent }))
