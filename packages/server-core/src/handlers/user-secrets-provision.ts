/**
 * PocketID / server-side per-user secret provisioning (T-19 stub).
 * Operator master secrets live in server vault; users receive opaque refs only.
 */

export type UserSecretRef = {
  key: string
  ref: string
  rotatedAt: string
}

export type ProvisionDefaultSecretsResult = {
  userId: string
  refs: UserSecretRef[]
}

const DEFAULT_KEY_IDS = [
  'ROX_API_KEY',
  'DAYTONA_API_KEY',
  'DEEPGRAM_API_KEY',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'EXA_API_KEY',
  'FIRECRAWL_API_KEY',
  'BRAVE_API_KEY',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
] as const

/** TODO(PocketID): call from post-auth registration hook on server. */
export async function provisionDefaultSecretsForUser(
  userId: string,
): Promise<ProvisionDefaultSecretsResult> {
  const rotatedAt = new Date().toISOString()
  const refs: UserSecretRef[] = DEFAULT_KEY_IDS.map((key) => ({
    key,
    ref: `rox://secret/${userId}/${key}/v1`,
    rotatedAt,
  }))
  return { userId, refs }
}
