/**
 * Test-only isolation guard: гарантирует временный CONFIG_DIR для автономных
 * запусков файла вне корневого bunfig (bunfig [test].preload подхватывается
 * только из cwd репозитория). Должен импортироваться ПЕРВЫМ в тест-файле —
 * ESM исполняет импорты по порядку объявления, поэтому env будет установлен
 * до инициализации storage.ts.
 *
 * Корневой preload (scripts/test-config-isolation.ts) делает то же самое для
 * прогонов из корня; здесь — дублирование на случай запуска одного файла
 * из директории пакета.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (!process.env.ROX_CONFIG_DIR && !process.env.CRAFT_CONFIG_DIR) {
  process.env.CRAFT_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'sm-refresh-iso-'))
}
