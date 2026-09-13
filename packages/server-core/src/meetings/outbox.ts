export type OutboxEntry = {
  operationId: string
  idempotencyKey: string
  payloadHash: string
}

export function reserveOutbox(existing: readonly OutboxEntry[], next: OutboxEntry): { reserved: boolean; entry: OutboxEntry } {
  const found = existing.find((item) => item.idempotencyKey === next.idempotencyKey)
  if (found) return { reserved: false, entry: found }
  return { reserved: true, entry: next }
}
