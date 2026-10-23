/**
 * LiveKit access-token minting (HS256 JWT, LiveKit claim format) with node:crypto.
 * No dependency: the claim set is the documented LiveKit grant
 * (https://docs.livekit.io/home/get-started/authentication/).
 * Never log the secret or the minted token.
 */
import { createHmac, randomUUID } from 'crypto'

export interface LiveKitGrantInput {
  apiKey: string
  apiSecret: string
  identity: string
  name?: string
  room: string
  /** Seconds; default 4 h so LiveKit reconnects (which re-validate the token) work for long calls. */
  ttlSeconds?: number
  canPublish?: boolean
  canSubscribe?: boolean
  canPublishData?: boolean
  hidden?: boolean
  metadata?: string
  nowSeconds?: number
}

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

export function mintLiveKitToken(input: LiveKitGrantInput): string {
  if (!input.apiKey || !input.apiSecret) throw new Error('LiveKit credentials are not configured')
  if (!input.identity || !input.room) throw new Error('identity and room are required')
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  const ttl = Math.min(Math.max(60, input.ttlSeconds ?? 4 * 3600), 6 * 3600)
  const payload = {
    iss: input.apiKey,
    sub: input.identity,
    ...(input.name ? { name: input.name } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    nbf: now - 10,
    iat: now,
    exp: now + ttl,
    jti: randomUUID(),
    video: {
      room: input.room,
      roomJoin: true,
      canPublish: input.canPublish ?? true,
      canSubscribe: input.canSubscribe ?? true,
      canPublishData: input.canPublishData ?? true,
      ...(input.hidden ? { hidden: true } : {}),
    },
  }
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = b64url(createHmac('sha256', input.apiSecret).update(`${head}.${body}`).digest())
  return `${head}.${body}.${sig}`
}
