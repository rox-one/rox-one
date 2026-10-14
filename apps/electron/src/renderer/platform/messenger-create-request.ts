/**
 * Global «+» → «Новое сообщение» → group / channel: opens the Messenger create
 * form preset to that kind. The menu navigates to `messenger` and leaves a
 * one-shot pending request here; MessengerChannels consumes it on mount or
 * on the change event when it is already mounted.
 */
export type MessengerCreateKind = 'group' | 'channel'

const ROUTE_PREFIX = 'messenger?create='
let pending: MessengerCreateKind | null = null
const listeners = new Set<(kind: MessengerCreateKind) => void>()

export function messengerCreateRoute(kind: MessengerCreateKind): string {
  return `${ROUTE_PREFIX}${kind}`
}

export function parseMessengerCreateRoute(route: string): MessengerCreateKind | null {
  if (!route.startsWith(ROUTE_PREFIX)) return null
  const kind = route.slice(ROUTE_PREFIX.length)
  return kind === 'group' || kind === 'channel' ? kind : null
}

export function requestMessengerCreate(kind: MessengerCreateKind): void {
  pending = kind
  for (const listener of [...listeners]) listener(kind)
}

/** Returns and clears the pending request. */
export function takeMessengerCreateRequest(): MessengerCreateKind | null {
  const kind = pending
  pending = null
  return kind
}

export function onMessengerCreateRequest(listener: (kind: MessengerCreateKind) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
