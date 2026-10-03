/** Select and safely import the canonical config before other modules freeze paths. */
import { resolveConfigDir } from '@rox/shared/config/paths'

resolveConfigDir()
