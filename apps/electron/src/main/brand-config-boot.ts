/** Select and safely import the canonical config before other modules freeze paths. */
import { resolveConfigDir } from '@rox/shared/config/paths'
import { runVisibleConfigMigration } from '@rox/shared/identity'

// Establish the visible ~/rox base before the canonical resolver picks a root.
runVisibleConfigMigration()
resolveConfigDir()
