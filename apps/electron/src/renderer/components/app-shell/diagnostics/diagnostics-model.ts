import type { DeviceDiagnosticSnapshot } from '../../../../shared/device-diagnostics'
import type { TransportConnectionState } from '../../../../shared/types'

export function diagnosticEndpoint(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return ['ws:', 'wss:', 'http:', 'https:'].includes(parsed.protocol) ? parsed.origin : null
  } catch { return null }
}

/** Explicit projection: never copy URLs with credentials, error payloads or tokens. */
export function diagnosticConnection(transport: TransportConnectionState | null) {
  return transport ? {
    mode: transport.mode,
    status: transport.status,
    endpoint: diagnosticEndpoint(transport.url),
    attempt: transport.attempt,
    errorKind: transport.lastError?.kind ?? null,
    closeCode: transport.lastClose?.code ?? null,
  } : null
}

export function networkRates(current: DeviceDiagnosticSnapshot | null, previous: DeviceDiagnosticSnapshot | null) {
  if (current?.kind !== 'network' || previous?.kind !== 'network' || current.result.status !== 'available' || previous.result.status !== 'available') return null
  const seconds = (current.sampledAt - previous.sampledAt) / 1000
  if (seconds <= 0) return null
  let receivedBytesPerSecond = 0
  let sentBytesPerSecond = 0
  let comparable = 0
  for (const row of current.result.data.interfaces) {
    if (row.internal) continue
    const before = previous.result.data.interfaces.find(value => value.name === row.name)
    if (!before || before.receivedBytes === null || before.sentBytes === null || row.receivedBytes === null || row.sentBytes === null
      || row.receivedBytes < before.receivedBytes || row.sentBytes < before.sentBytes) continue
    receivedBytesPerSecond += (row.receivedBytes - before.receivedBytes) / seconds
    sentBytesPerSecond += (row.sentBytes - before.sentBytes) / seconds
    comparable++
  }
  return comparable ? { receivedBytesPerSecond, sentBytesPerSecond } : null
}
