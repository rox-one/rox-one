export const OPEN_DESIGN_IPC_CHANNELS = {
  OPEN: 'open-design:open',
  STATUS: 'open-design:status',
  STOP: 'open-design:stop',
} as const

export type OpenDesignRuntimeState =
  | 'disabled'
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'

export type OpenDesignRuntimeReason =
  | 'not-configured'
  | 'invalid-root'
  | 'start-failed'
  | 'stop-failed'
  | 'ipc-unreachable'
  | 'invalid-url'
  | 'stopped'

export interface OpenDesignRuntimeStatus {
  canOpen: boolean
  enabled: boolean
  message?: string
  reason?: OpenDesignRuntimeReason
  state: OpenDesignRuntimeState
  updatedAt: number
  windowOpen: boolean
}

export interface OpenDesignApi {
  open(): Promise<OpenDesignRuntimeStatus>
  status(): Promise<OpenDesignRuntimeStatus>
  stop(): Promise<OpenDesignRuntimeStatus>
}

export function validateOpenDesignInitialUrl(rawUrl: string): string {
  if (!/^http:\/\/(?:127\.0\.0\.1|\[::1\]):\d{1,5}(?:\/.*)?$/.test(rawUrl)) {
    throw new Error('Open Design web URL must use canonical loopback http with an explicit port')
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('Open Design web URL is not valid')
  }

  if (parsed.protocol !== 'http:') {
    throw new Error('Open Design web URL must use http')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('Open Design web URL must not include credentials')
  }
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== '[::1]') {
    throw new Error('Open Design web URL must use a canonical loopback host')
  }
  if (parsed.port === '') {
    throw new Error('Open Design web URL must include an explicit port')
  }
  const port = Number(parsed.port)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Open Design web URL port is out of range')
  }
  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new Error('Open Design web URL must not include a custom path, query, or hash')
  }

  return `${parsed.origin}/`
}

export function isAllowedOpenDesignNavigation(targetUrl: string, initialUrl: string): boolean {
  try {
    const target = new URL(targetUrl)
    const initial = new URL(initialUrl)
    return target.protocol === 'http:' && target.origin === initial.origin
  } catch {
    return false
  }
}
