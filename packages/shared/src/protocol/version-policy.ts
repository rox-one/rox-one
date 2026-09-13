/**
 * Handshake protocol major-version policy (iOS / native clients).
 * Same rule as `packages/server-core/src/transport/server.ts`:
 * missing version or a different major is incompatible. Minor may differ.
 */

export function protocolMajor(version: string): number | null {
  const trimmed = version.trim()
  if (!trimmed) return null
  const head = trimmed.split('.')[0]
  if (!head || !/^\d+$/.test(head)) return null
  return Number.parseInt(head, 10)
}

export function protocolVersionsCompatible(client: string, server: string): boolean {
  const clientMajor = protocolMajor(client)
  const serverMajor = protocolMajor(server)
  if (clientMajor === null || serverMajor === null) return false
  return clientMajor === serverMajor
}

export function protocolVersionRejectionMessage(client: string, server: string): string {
  return `Server protocol ${server || 'missing'}, client ${client}`
}
