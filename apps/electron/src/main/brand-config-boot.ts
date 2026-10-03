/** Select and safely import the canonical config before other modules freeze paths. */
import { resolveConfigDir } from '@craft-agent/shared/config/paths'

resolveConfigDir()
