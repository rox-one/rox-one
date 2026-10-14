import { setBuiltinCallCredentials } from '@rox/shared/team-chat'
import { CALL_DEFAULTS } from './call-defaults.generated'

/** Hands the build-time shared defaults to the shared credential resolver (main process only). */
export function installCallDefaults(): void {
  setBuiltinCallCredentials(CALL_DEFAULTS)
}
