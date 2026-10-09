import log from 'electron-log/main'
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveConfigDir } from '@rox/shared/config/paths'
import { redactSensitiveValues, redactUrlForLog } from '@rox/shared/utils/redaction'
import type {
  MessagingLogContext,
  MessagingLogMeta,
  MessagingLogger,
} from '@rox/messaging-gateway'

/**
 * Resolve debug mode deterministically across runtimes.
 *
 * Priority:
 * 1) --debug flag always enables debug mode
 * 2) CRAFT_IS_PACKAGED env (when explicitly set)
 * 3) Electron runtime heuristic (defaultApp => dev, otherwise packaged)
 * 4) Non-Electron runtimes default to debug mode (headless Bun / node --check)
 */
function resolveDebugMode(): boolean {
  if (process.argv.includes('--debug')) return true

  const packagedEnv = process.env.CRAFT_IS_PACKAGED
  if (packagedEnv === 'true') return false
  if (packagedEnv === 'false') return true

  const isElectronRuntime = typeof process.versions?.electron === 'string'
  if (isElectronRuntime) {
    if (process.defaultApp) return true
    return false
  }

  return true
}

export const isDebugMode = resolveDebugMode()

// Configure transports based on debug mode
if (isDebugMode) {
  // JSON format for file (agent-parseable)
  // Note: format expects (params: FormatParams) => any[], where params.message has the LogMessage fields
  log.transports.file.format = ({ message }) => [
    JSON.stringify({
      timestamp: message.date.toISOString(),
      level: message.level,
      scope: message.scope,
      message: message.data,
    }),
  ]

  log.transports.file.maxSize = 5 * 1024 * 1024 // 5MB

  // Console output in debug mode with readable format
  // Note: format must return an array - electron-log's transformStyles calls .reduce() on it
  log.transports.console.format = ({ message }) => {
    const scope = message.scope ? `[${message.scope}]` : ''
    const level = message.level.toUpperCase().padEnd(5)
    const data = message.data
      .map((d: unknown) => (typeof d === 'object' ? JSON.stringify(d) : String(d)))
      .join(' ')
    return [`${message.date.toISOString()} ${level} ${scope} ${data}`]
  }
  log.transports.console.level = 'debug'
} else {
  // Disable file and console transports in production
  log.transports.file.level = false
  log.transports.console.level = false
}

// Export scoped loggers for different modules
export const mainLog = log.scope('main')
export const sessionLog = log.scope('session')
export const handlerLog = log.scope('handler')
export const windowLog = log.scope('window')
export const agentLog = log.scope('agent')
export const searchLog = log.scope('search')

/**
 * Dedicated messaging gateway log.
 *
 * Kept outside the Electron-managed logs folder so messaging issues can be
 * inspected independently at a stable path across debug and production builds.
 */
export const messagingGatewayLogPath = join(resolveConfigDir(), 'logs', 'messaging-gateway.log')
const messagingGatewayBackupPath = `${messagingGatewayLogPath}.1`
const MESSAGING_LOG_MAX_BYTES = 5 * 1024 * 1024 // 5MB

function ensureMessagingLogDir(): void {
  mkdirSync(dirname(messagingGatewayLogPath), { recursive: true })
}

function rotateMessagingLogIfNeeded(nextLineBytes: number): void {
  if (!existsSync(messagingGatewayLogPath)) return
  try {
    const currentSize = statSync(messagingGatewayLogPath).size
    if (currentSize + nextLineBytes <= MESSAGING_LOG_MAX_BYTES) return
    if (existsSync(messagingGatewayBackupPath)) {
      rmSync(messagingGatewayBackupPath, { force: true })
    }
    renameSync(messagingGatewayLogPath, messagingGatewayBackupPath)
  } catch (error) {
    mainLog.warn('[messaging-gateway] failed to rotate dedicated log file', normalizeLogValue(error))
  }
}

function normalizeLogValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]'
  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      name: value.name,
      message: value.message,
    }
    const code = (value as { code?: unknown }).code
    if (code !== undefined) out.code = code
    const cause = (value as { cause?: unknown }).cause
    if (cause !== undefined) out.cause = normalizeLogValue(cause, depth + 1)
    if (value.stack) out.stack = value.stack
    return out
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeLogValue(item, depth + 1))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value)) {
      out[key] = normalizeLogValue(inner, depth + 1)
    }
    return out
  }
  return value
}

function normalizeMeta(meta?: MessagingLogMeta): Record<string, unknown> {
  if (!meta) return {}
  const normalized = normalizeLogValue(meta)
  return normalized && typeof normalized === 'object' && !Array.isArray(normalized)
    ? normalized as Record<string, unknown>
    : { meta: normalized }
}

function writeMessagingGatewayLog(
  level: 'info' | 'warn' | 'error',
  context: MessagingLogContext,
  message: string,
  meta?: MessagingLogMeta,
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    scope: 'messaging-gateway',
    ...context,
    ...normalizeMeta(meta),
    message,
  }

  const line = JSON.stringify(entry) + '\n'
  try {
    ensureMessagingLogDir()
    rotateMessagingLogIfNeeded(Buffer.byteLength(line))
    appendFileSync(messagingGatewayLogPath, line, 'utf8')
  } catch (error) {
    mainLog.warn('[messaging-gateway] failed to write dedicated log entry', {
      error: normalizeLogValue(error),
      attemptedEntry: entry,
    })
  }

  if (level === 'error') {
    mainLog.error('[messaging-gateway]', message, entry)
  } else if (level === 'warn') {
    mainLog.warn('[messaging-gateway]', message, entry)
  } else if (isDebugMode) {
    mainLog.info('[messaging-gateway]', message, entry)
  }
}

class StructuredMessagingGatewayLogger implements MessagingLogger {
  constructor(private readonly context: MessagingLogContext = {}) {}

  child(context: MessagingLogContext): MessagingLogger {
    return new StructuredMessagingGatewayLogger({
      ...this.context,
      ...context,
    })
  }

  info(message: string, meta?: MessagingLogMeta): void {
    writeMessagingGatewayLog('info', this.context, message, meta)
  }

  warn(message: string, meta?: MessagingLogMeta): void {
    writeMessagingGatewayLog('warn', this.context, message, meta)
  }

  error(message: string, meta?: MessagingLogMeta): void {
    writeMessagingGatewayLog('error', this.context, message, meta)
  }
}

export const messagingGatewayLog: MessagingLogger = new StructuredMessagingGatewayLogger({
  component: 'root',
})

/**
 * Factory for the always-on rotating JSON logs that must survive packaged
 * builds (where the Electron file/console transports are disabled, see above).
 *
 * Each line is one self-contained JSON object: `{timestamp, level, scope,
 * meta?, message}`. The file lives under `<config>/logs/<fileName>`, is
 * created lazily, and rotates to `<fileName>.1` once `maxBytes` would be
 * exceeded (the previous backup is dropped first, so at most one backup is
 * kept).
 */
function createDurableLog(options: {
  fileName: string
  scope: string
  maxBytes: number
  /** Rewrite the (already `normalizeLogValue`'d) meta before it is persisted. */
  sanitizeMeta?: (meta: unknown) => unknown
}): { filePath: string; write: (level: 'info' | 'warn' | 'error', message: string, meta?: unknown) => void } {
  const { fileName, scope, maxBytes } = options
  const filePath = join(resolveConfigDir(), 'logs', fileName)
  const backupPath = `${filePath}.1`

  function rotateIfNeeded(nextLineBytes: number): void {
    if (!existsSync(filePath)) return
    try {
      const currentSize = statSync(filePath).size
      if (currentSize + nextLineBytes <= maxBytes) return
      if (existsSync(backupPath)) {
        rmSync(backupPath, { force: true })
      }
      renameSync(filePath, backupPath)
    } catch (error) {
      mainLog.warn(`[${scope}] failed to rotate dedicated log file`, normalizeLogValue(error))
    }
  }

  function write(level: 'info' | 'warn' | 'error', message: string, meta?: unknown): void {
    const normalizedMeta = meta !== undefined ? normalizeLogValue(meta) : undefined
    const sanitizedMeta = normalizedMeta !== undefined && options.sanitizeMeta
      ? options.sanitizeMeta(normalizedMeta)
      : normalizedMeta
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      scope,
      ...(sanitizedMeta !== undefined ? { meta: sanitizedMeta } : {}),
      message,
    }

    const line = JSON.stringify(entry) + '\n'
    try {
      mkdirSync(dirname(filePath), { recursive: true })
      rotateIfNeeded(Buffer.byteLength(line))
      appendFileSync(filePath, line, 'utf8')
    } catch (error) {
      mainLog.warn(`[${scope}] failed to write dedicated log entry`, normalizeLogValue(error))
    }

    // Mirror to the Electron logger too (a no-op in production where transports
    // are disabled, but keeps --debug console/file output intact).
    if (level === 'error') {
      mainLog.error(`[${scope}]`, message, entry)
    } else if (level === 'warn') {
      mainLog.warn(`[${scope}]`, message, entry)
    } else if (isDebugMode) {
      mainLog.info(`[${scope}]`, message, entry)
    }
  }

  return { filePath, write }
}

/**
 * Dedicated auto-update log.
 *
 * In packaged builds the Electron file/console transports are disabled (see
 * above), so every `[auto-update]` / `[update-flow]` diagnostic is dropped —
 * leaving update-install failures undiagnosable in the field (see #891). This
 * dedicated, always-on rotating log records the update lifecycle at a stable
 * path regardless of debug mode, mirroring the messaging-gateway log above.
 */
const autoUpdateDurableLog = createDurableLog({
  fileName: 'auto-update.log',
  scope: 'auto-update',
  maxBytes: 2 * 1024 * 1024, // 2MB
})
export const autoUpdateLogPath = autoUpdateDurableLog.filePath

/** Always-on structured logger for the auto-update lifecycle (see #891). */
export const autoUpdateLog = {
  info: (message: string, meta?: unknown) => autoUpdateDurableLog.write('info', message, meta),
  warn: (message: string, meta?: unknown) => autoUpdateDurableLog.write('warn', message, meta),
  error: (message: string, meta?: unknown) => autoUpdateDurableLog.write('error', message, meta),
}

export function getAutoUpdateLogFilePath(): string {
  return autoUpdateLogPath
}

const URL_VALUE_PATTERN = /^https?:\/\//i

/**
 * Scrub secrets out of an error-log `meta` payload before it is persisted: URL
 * query values are masked (deep, cycle-safe), then credential-named keys
 * (authorization, cookie, token, …) are replaced. Error objects are already
 * flattened to `{name, message, stack, …}` by `normalizeLogValue`, so their
 * `message` / `stack` text passes through untouched.
 */
function redactUrlValues(value: unknown, depth = 0): unknown {
  if (depth > 6) return value
  if (typeof value === 'string') {
    return URL_VALUE_PATTERN.test(value) ? redactUrlForLog(value) : value
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactUrlValues(item, depth + 1))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value)) {
      out[key] = redactUrlValues(inner, depth + 1)
    }
    return out
  }
  return value
}

/**
 * Dedicated errors log.
 *
 * After Sentry was removed, the main-process error handlers could only write
 * to the Electron transports, which are disabled in packaged builds — so
 * production errors were lost entirely. This always-on structured log keeps
 * them on disk at `<config>/logs/errors.log` regardless of debug mode.
 */
const errorDurableLog = createDurableLog({
  fileName: 'errors.log',
  scope: 'errors',
  maxBytes: 5 * 1024 * 1024, // 5MB
  sanitizeMeta: (meta) => redactSensitiveValues(redactUrlValues(meta)),
})
export const errorLogPath = errorDurableLog.filePath

/** Always-on structured logger for main-process errors. */
export const errorLog = {
  info: (message: string, meta?: unknown) => errorDurableLog.write('info', message, meta),
  warn: (message: string, meta?: unknown) => errorDurableLog.write('warn', message, meta),
  error: (message: string, meta?: unknown) => errorDurableLog.write('error', message, meta),
}

export function getErrorLogFilePath(): string {
  return errorLogPath
}

/**
 * Get the path to the current Electron main log file.
 * Returns undefined if file logging is disabled.
 */
export function getLogFilePath(): string | undefined {
  if (!isDebugMode) return undefined
  return log.transports.file.getFile()?.path
}

export function getMessagingGatewayLogFilePath(): string {
  return messagingGatewayLogPath
}

export default log