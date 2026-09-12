/**
 * Issue 33: copy ~/.craft-agent → ~/.rox before other config modules freeze
 * CONFIG_DIR. This file must stay the first import of the Electron main entry.
 */
import { runBrandConfigMigration } from '@craft-agent/shared/identity'

runBrandConfigMigration()
