/**
 * Test helper: replace the main logger (electron-log → electron binary, not
 * installed in CI clones) with no-op scopes. Exposes the module's full export
 * surface because `mock.module` is process-wide in `bun test`: a partial stub
 * would break later suites that import other logger exports (`windowLog`, …).
 */
import { mock } from 'bun:test'

const scope = () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, verbose: () => {}, silly: () => {}, log: () => {} })

export function stubMainLogger(): void {
  const noop = () => undefined
  mock.module(new URL('../logger.ts', import.meta.url).pathname, () => ({
    default: { ...scope(), scope },
    isDebugMode: false,
    mainLog: scope(),
    sessionLog: scope(),
    handlerLog: scope(),
    windowLog: scope(),
    agentLog: scope(),
    searchLog: scope(),
    messagingGatewayLogPath: '',
    messagingGatewayLog: scope(),
    autoUpdateLogPath: '',
    autoUpdateLog: scope(),
    getAutoUpdateLogFilePath: () => '',
    getLogFilePath: noop,
    getMessagingGatewayLogFilePath: () => '',
  }))
}
