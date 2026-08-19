/**
 * Minimal in-memory R2 binding fake for testing Pages Functions without
 * wrangler/miniflare. Implements only the surface the share API uses:
 * put (with customMetadata), get, head, delete.
 */

export interface FakeR2StoredObject {
  body: string
  httpMetadata?: { contentType?: string }
  customMetadata?: Record<string, string>
}

let ipCounter = 0
/** Unique fake client IP per call — keeps rate-limiter state isolated between tests. */
export function uniqueIp(): string {
  ipCounter += 1
  return `203.0.113.${ipCounter % 250}.${Math.floor(ipCounter / 250) + 1}`
}

export class FakeR2Bucket {
  private store = new Map<string, FakeR2StoredObject>()

  async put(key: string, value: string, opts?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) {
    this.store.set(key, {
      body: value,
      httpMetadata: opts?.httpMetadata,
      customMetadata: opts?.customMetadata ? { ...opts.customMetadata } : undefined,
    })
    return { key }
  }

  async get(key: string) {
    const obj = this.store.get(key)
    if (!obj) return null
    return {
      key,
      customMetadata: obj.customMetadata,
      httpMetadata: obj.httpMetadata,
      text: async () => obj.body,
    }
  }

  async head(key: string) {
    const obj = this.store.get(key)
    if (!obj) return null
    return { key, customMetadata: obj.customMetadata, httpMetadata: obj.httpMetadata }
  }

  async delete(key: string) {
    this.store.delete(key)
  }

  /** Test inspection helper: raw view of stored state. */
  inspect(key: string): FakeR2StoredObject | undefined {
    return this.store.get(key)
  }

  /** Seed a share the way pre-auth shares exist in production: no ownerkeyhash metadata. */
  seedLegacy(key: string, body: string) {
    this.store.set(key, {
      body,
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { sessionId: 'legacy-session', createdAt: '1700000000000' },
    })
  }
}

export function jsonRequest(
  url: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
  ip?: string,
): Request {
  return new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(ip ? { 'CF-Connecting-IP': ip } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

export function mutateRequest(
  url: string,
  method: 'PUT' | 'DELETE',
  headers: Record<string, string> = {},
  ip?: string,
): Request {
  return new Request(url, {
    method,
    headers: { ...(ip ? { 'CF-Connecting-IP': ip } : {}), ...headers },
  })
}
