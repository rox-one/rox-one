import { existsSync } from 'node:fs'

/** Never weaken explicitly requested config guards when their CLI is missing. */
export function validateConfigurationCliEntries(env: NodeJS.ProcessEnv): void {
  for (const variable of ['CRAFT_COMMANDS_ENTRY', 'CRAFT_CLI_ENTRY'] as const) {
    const entry = env[variable]
    if (entry && !existsSync(entry)) delete env[variable]
  }
  const required = ['1', 'true', 'yes', 'on'].includes((env.CRAFT_FEATURE_CRAFT_AGENTS_CLI ?? '').trim().toLowerCase())
  if (required && !env.CRAFT_COMMANDS_ENTRY && !env.CRAFT_CLI_ENTRY) {
    throw new Error('Configuration CLI guards were explicitly enabled, but no working CLI entry exists. Supply an existing CRAFT_COMMANDS_ENTRY or explicitly disable CRAFT_FEATURE_CRAFT_AGENTS_CLI. ROX has not disabled your configuration guards.')
  }
}
