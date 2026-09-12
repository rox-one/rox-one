/**
 * Test-side env setup: config dir is read by
 * @craft-agent/shared/config/paths at module-eval time, so it must be set
 * before any module under test loads. Import this file FIRST in handler tests.
 *
 * bun test preload already sets ROX_CONFIG_DIR, and resolveConfigDir() prefers
 * it over CRAFT_*. Align both names onto one directory so lazy env readers and
 * the frozen CONFIG_DIR snapshot stay in the same sandbox.
 */
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const configDir =
  process.env.ROX_CONFIG_DIR ||
  process.env.CRAFT_CONFIG_DIR ||
  mkdtempSync(join(tmpdir(), 'mem-hdl-config-'))
process.env.ROX_CONFIG_DIR = configDir
process.env.CRAFT_CONFIG_DIR = configDir
