import { registerSecretValues } from '@rox/shared/secrets'

/**
 * Shared ROX gateway key for every install (product decision: the key is
 * shared and embedded in the client). It only fills ROX_API_KEY when the
 * user's environment does not already provide one, so a personal key wins.
 * Downstream, seedDefaultLlmConnection() stores it for the default `rox-kimi`
 * connection and every OMP spawn receives it through the env indirection.
 *
 * The installed value is registered with the redaction registry, so a child
 * that echoes it (OMP debug output, runtime traces) is masked; the value is
 * never logged by this module.
 */
export function installRoxDefaults(
  defaults: { readonly roxApiKey?: string } | undefined,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): 'env' | 'embedded' | 'none' {
  if (env.ROX_API_KEY?.trim()) return 'env'
  const embedded = defaults?.roxApiKey?.trim()
  if (!embedded) return 'none'
  env.ROX_API_KEY = embedded
  registerSecretValues([embedded])
  return 'embedded'
}
