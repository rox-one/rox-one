import {
  VOICE_ACCESS_TOKEN_TTL_MS,
  VOICE_ENDPOINTS,
  VOICE_PUBLIC_CLIENT_ID,
  VOICE_SCOPES,
  assertVoiceOnlyScopes,
  voiceUrl,
} from './contracts.ts'

export interface VoiceToken {
  accessToken: string
  expiresAt: number
  scopes: string[]
  installationId: string
  accountId?: string
}

export interface VoiceIdentityStore {
  read(): Promise<VoiceToken | null>
  write(token: VoiceToken): Promise<void>
  clear(): Promise<void>
}

export interface VoiceIdentityHttp {
  fetch(input: string, init: RequestInit): Promise<Response>
}

export class VoiceIdentityError extends Error {
  readonly code: 'bootstrap' | 'refresh' | 'scope'
  constructor(code: VoiceIdentityError['code'], message: string) {
    super(message)
    this.name = 'VoiceIdentityError'
    this.code = code
  }
}

export class VoiceIdentityClient {
  private inflight: Promise<VoiceToken> | null = null

  constructor(
    private readonly store: VoiceIdentityStore,
    private readonly http: VoiceIdentityHttp,
    private readonly options: { baseUrl?: string; now?: () => number } = {},
  ) {}

  async bearer(): Promise<string> {
    const token = await this.ensure()
    return token.accessToken
  }

  async ensure(): Promise<VoiceToken> {
    const now = this.options.now?.() ?? Date.now()
    const existing = await this.store.read()
    if (existing && existing.expiresAt - 30_000 > now) return existing
    return this.refresh()
  }

  async refresh(): Promise<VoiceToken> {
    if (this.inflight) return this.inflight
    this.inflight = this.bootstrap().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  private async bootstrap(): Promise<VoiceToken> {
    const response = await this.http.fetch(voiceUrl(VOICE_ENDPOINTS.bootstrap, this.options.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: VOICE_PUBLIC_CLIENT_ID,
        scopes: [...VOICE_SCOPES],
      }),
    })
    if (!response.ok) throw new VoiceIdentityError('bootstrap', `Bootstrap failed (${response.status})`)
    const json = await response.json() as Record<string, unknown>
    const scopes = Array.isArray(json.scopes) ? json.scopes.filter((item): item is string => typeof item === 'string') : [...VOICE_SCOPES]
    assertVoiceOnlyScopes(scopes)
    const expiresIn = typeof json.expiresIn === 'number' ? json.expiresIn * 1000 : VOICE_ACCESS_TOKEN_TTL_MS
    const token: VoiceToken = {
      accessToken: typeof json.accessToken === 'string' ? json.accessToken : '',
      expiresAt: (this.options.now?.() ?? Date.now()) + expiresIn,
      scopes,
      installationId: typeof json.installationId === 'string' ? json.installationId : 'local',
      accountId: typeof json.accountId === 'string' ? json.accountId : undefined,
    }
    if (!token.accessToken) throw new VoiceIdentityError('bootstrap', 'Bootstrap returned an empty token')
    await this.store.write(token)
    return token
  }
}

export function memoryIdentityStore(initial: VoiceToken | null = null): VoiceIdentityStore {
  let token = initial
  return {
    async read() { return token },
    async write(next) { token = next },
    async clear() { token = null },
  }
}
