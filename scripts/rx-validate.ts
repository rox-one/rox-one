#!/usr/bin/env bun
/**
 * RX-валидатор — проверка грамматики, уникальности и ссылок идентификаторов RX-*.
 *
 * Запуск:
 *   bun run scripts/rx-validate.ts
 *   bun run rx:validate
 *
 * YAML разбирается встроенным Bun.YAML.parse: js-yaml есть только транзитивно
 * (eslint, electron-builder) и не является прямой зависимостью корня, а новые
 * пакеты добавлять нельзя. Схема записей — плоский список объектов.
 *
 * Отсутствие registry/rx-registry.yaml и каталога fragments — не ошибка:
 * соседние агенты могут ещё не создать эти файлы.
 *
 * Код выхода: 1 при ошибках, 0 при отсутствии ошибок (предупреждения допустимы).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')

/** Каноническое регулярное выражение из registry/RX-LEGEND.md. */
const ID_RE =
  /\bRX-(TSK|EPC|FEA|CMP|PKG|SRF|INT|PLG|AUT|PIP|AST|ADR|SPC|DOC|SES|SEC|RSK|API|DAT)-\d{4}(\.\d{2})?\b/

const STATUS_KEYS = ['planned', 'active', 'blocked', 'done', 'dropped'] as const
type StatusKey = (typeof STATUS_KEYS)[number]
const STATUS_SET = new Set<string>(STATUS_KEYS)

const REGISTRY_FILE = join(ROOT, 'registry', 'rx-registry.yaml')
const FRAGMENTS_DIR = join(ROOT, 'registry', 'fragments')
const DOCS_RU_DIR = join(ROOT, 'docs', 'ru')

interface RxEntry {
  id: string
  status: string
  path?: string
  refs: string[]
  source: string
  index: number
}

interface Issue {
  kind: 'error' | 'warning'
  message: string
}

const errors: Issue[] = []
const warnings: Issue[] = []

const error = (message: string): void => {
  errors.push({ kind: 'error', message })
}
const warn = (message: string): void => {
  warnings.push({ kind: 'warning', message })
}

const rel = (abs: string): string => {
  const r = relative(ROOT, abs)
  return r || '.'
}

const isStatus = (value: string): value is StatusKey => STATUS_SET.has(value)

/** Идентификатор целиком совпадает с каноническим регулярным выражением. */
const isCanonicalId = (value: string): boolean => {
  const match = value.match(ID_RE)
  return match !== null && match[0] === value
}

const readText = (abs: string): string => readFileSync(abs, 'utf8').replace(/^\uFEFF/, '')

/**
 * Приводит корень YAML к списку записей.
 * Допускается: список, пустой документ, один объект с полем id,
 * обёртка entries/items/records/entities.
 */
const asEntryList = (parsed: unknown, source: string): unknown[] => {
  if (parsed == null) return []
  if (Array.isArray(parsed)) return parsed
  if (typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    for (const key of ['entries', 'items', 'records', 'entities']) {
      const inner = obj[key]
      if (Array.isArray(inner)) return inner
    }
    if (typeof obj.id === 'string') return [obj]
  }
  error(`${source}: корень YAML должен быть списком записей, получено: ${typeof parsed}`)
  return []
}

const parseYamlFile = (abs: string): unknown[] => {
  const source = rel(abs)
  let parsed: unknown
  try {
    parsed = Bun.YAML.parse(readText(abs))
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    error(`${source}: не удалось разобрать YAML (${reason})`)
    return []
  }
  return asEntryList(parsed, source)
}

const asStringList = (value: unknown): string[] | null => {
  if (value == null) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) {
    const out: string[] = []
    for (const item of value) {
      if (item == null) continue
      if (typeof item === 'string' || typeof item === 'number') {
        out.push(String(item))
        continue
      }
      return null
    }
    return out
  }
  return null
}

const collectYamlSources = (): string[] => {
  const files: string[] = []
  if (existsSync(REGISTRY_FILE) && statSync(REGISTRY_FILE).isFile()) {
    files.push(REGISTRY_FILE)
  }
  if (!existsSync(FRAGMENTS_DIR)) return files
  let st
  try {
    st = statSync(FRAGMENTS_DIR)
  } catch {
    return files
  }
  if (!st.isDirectory()) {
    error(`${rel(FRAGMENTS_DIR)}: ожидался каталог фрагментов`)
    return files
  }
  const names = readdirSync(FRAGMENTS_DIR)
    .filter((name) => name.endsWith('.yaml') && !name.startsWith('.'))
    .sort()
  for (const name of names) {
    const abs = join(FRAGMENTS_DIR, name)
    try {
      if (statSync(abs).isFile()) files.push(abs)
    } catch {
      warn(`${rel(abs)}: не удалось прочитать файл фрагмента`)
    }
  }
  return files
}

const loadEntries = (files: string[]): RxEntry[] => {
  const entries: RxEntry[] = []
  const seen = new Map<string, string>()

  for (const abs of files) {
    const source = rel(abs)
    const rows = parseYamlFile(abs)
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const loc = `${source}#${i + 1}`
      if (row == null || typeof row !== 'object' || Array.isArray(row)) {
        error(`${loc}: запись должна быть объектом`)
        continue
      }
      const rec = row as Record<string, unknown>
      const idRaw = rec.id
      if (typeof idRaw !== 'string' || idRaw.trim() === '') {
        error(`${loc}: отсутствует поле id`)
        continue
      }
      const id = idRaw.trim()
      if (!isCanonicalId(id)) {
        error(`${loc}: идентификатор «${id}» не соответствует грамматике RX-<DOMAIN>-<NNNN>`)
        continue
      }
      const prev = seen.get(id)
      if (prev) {
        error(`${loc}: дубликат идентификатора ${id} (уже объявлен в ${prev})`)
        continue
      }
      seen.set(id, loc)

      const statusRaw = rec.status
      if (typeof statusRaw !== 'string' || statusRaw.trim() === '') {
        error(`${loc} (${id}): отсутствует поле status`)
      } else if (!isStatus(statusRaw.trim())) {
        error(
          `${loc} (${id}): status «${statusRaw}» не входит в словарь planned|active|blocked|done|dropped`,
        )
      }

      const refsParsed = asStringList(rec.refs)
      if (refsParsed == null) {
        error(`${loc} (${id}): поле refs должно быть списком идентификаторов`)
      }

      let path: string | undefined
      if (rec.path != null && rec.path !== '') {
        if (typeof rec.path !== 'string') {
          error(`${loc} (${id}): поле path должно быть строкой`)
        } else {
          path = rec.path.trim()
          if (path === '') path = undefined
        }
      }

      entries.push({
        id,
        status: typeof statusRaw === 'string' ? statusRaw.trim() : '',
        path,
        refs: refsParsed ?? [],
        source: loc,
        index: i,
      })
    }
  }

  return entries
}

const checkRefsAndPaths = (entries: RxEntry[]): void => {
  const ids = new Set(entries.map((e) => e.id))
  for (const entry of entries) {
    for (const ref of entry.refs) {
      const trimmed = ref.trim()
      if (!trimmed) {
        error(`${entry.source} (${entry.id}): пустая ссылка в refs`)
        continue
      }
      if (!isCanonicalId(trimmed)) {
        error(
          `${entry.source} (${entry.id}): ссылка «${trimmed}» не соответствует грамматике RX-*`,
        )
        continue
      }
      if (!ids.has(trimmed)) {
        error(
          `${entry.source} (${entry.id}): висячая ссылка ${trimmed} — идентификатор не найден в реестре`,
        )
      }
    }
    if (entry.path) {
      const abs = resolve(ROOT, entry.path)
      if (!existsSync(abs)) {
        warn(
          `${entry.source} (${entry.id}): путь «${entry.path}» не существует`,
        )
      }
    }
  }
}

const extractFrontMatter = (
  text: string,
): { yaml: string } | { missing: true } | { broken: string } => {
  if (!text.startsWith('---')) return { missing: true }
  const afterOpen = text.slice(3)
  const openNl = afterOpen.match(/^\r?\n/)
  if (!openNl) return { broken: 'после «---» нет перевода строки' }
  const body = afterOpen.slice(openNl[0].length)
  const close = body.match(/\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!close || close.index == null) {
    return { broken: 'не найден закрывающий маркер «---»' }
  }
  return { yaml: body.slice(0, close.index) }
}

const idFromDocFilename = (filename: string): string | null => {
  const match = filename.match(/^(RX-DOC-\d{4}(?:\.\d{2})?)(?:-.*)?\.md$/)
  return match ? match[1] : null
}

const checkDocuments = (): number => {
  if (!existsSync(DOCS_RU_DIR)) return 0
  let st
  try {
    st = statSync(DOCS_RU_DIR)
  } catch {
    return 0
  }
  if (!st.isDirectory()) return 0

  const files = readdirSync(DOCS_RU_DIR)
    .filter((name) => name.startsWith('RX-DOC-') && name.endsWith('.md'))
    .sort()

  for (const name of files) {
    const abs = join(DOCS_RU_DIR, name)
    const source = rel(abs)
    try {
      if (!statSync(abs).isFile()) continue
    } catch {
      warn(`${source}: не удалось прочитать документ`)
      continue
    }
    const expected = idFromDocFilename(name)
    if (!expected) {
      error(`${source}: имя файла не содержит кода RX-DOC-NNNN`)
      continue
    }
    const fm = extractFrontMatter(readText(abs))
    if ('missing' in fm) {
      error(`${source}: нет YAML front matter (ожидался rx-id: ${expected})`)
      continue
    }
    if ('broken' in fm) {
      error(`${source}: повреждён front matter (${fm.broken})`)
      continue
    }
    let parsed: unknown
    try {
      parsed = Bun.YAML.parse(fm.yaml)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      error(`${source}: не удалось разобрать front matter (${reason})`)
      continue
    }
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      error(`${source}: front matter должен быть словарём с полем rx-id`)
      continue
    }
    const rxId = (parsed as Record<string, unknown>)['rx-id']
    if (typeof rxId !== 'string' || rxId.trim() === '') {
      error(`${source}: во front matter нет поля rx-id`)
      continue
    }
    const actual = rxId.trim()
    if (actual !== expected) {
      error(
        `${source}: rx-id «${actual}» не совпадает с кодом в имени файла (${expected})`,
      )
    } else if (!isCanonicalId(actual)) {
      error(`${source}: rx-id «${actual}» не соответствует грамматике RX-*`)
    }
  }

  return files.length
}

const ruCount = (n: number, one: string, few: string, many: string): string => {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`
  return `${n} ${many}`
}

const printReport = (fileCount: number, entryCount: number, docCount: number): void => {
  console.log('=== Валидатор идентификаторов RX-* ===')
  console.log('')
  console.log(`Файлов реестра:  ${fileCount}`)
  console.log(`Записей:         ${entryCount}`)
  console.log(`Документов:      ${docCount}`)
  console.log('')

  if (errors.length === 0) {
    console.log('Ошибки: нет')
  } else {
    console.log(`Ошибки (${errors.length}):`)
    for (let i = 0; i < errors.length; i++) {
      console.log(`  ${i + 1}. ${errors[i].message}`)
    }
  }
  console.log('')

  if (warnings.length === 0) {
    console.log('Предупреждения: нет')
  } else {
    console.log(`Предупреждения (${warnings.length}):`)
    for (let i = 0; i < warnings.length; i++) {
      console.log(`  ${i + 1}. ${warnings[i].message}`)
    }
  }
  console.log('')

  const errLabel = ruCount(errors.length, 'ошибка', 'ошибки', 'ошибок')
  const warnLabel = ruCount(
    warnings.length,
    'предупреждение',
    'предупреждения',
    'предупреждений',
  )
  console.log(`Итог: ${errLabel}, ${warnLabel}.`)

  if (errors.length > 0) {
    console.log('Проверка не пройдена.')
  } else if (warnings.length > 0) {
    console.log('Проверка пройдена (есть предупреждения).')
  } else {
    console.log('Проверка пройдена.')
  }
}

/**
 * Дрифт-гард: пер-пакетные bunfig.toml обязаны зеркалировать корневой.
 * Bun грузит bunfig только из cwd, поэтому расхождение секций между корнем
 * и пакетами молча меняет поведение локальных прогонов (класс утечки
 * 2026-08-23: тесты из директории пакета писали в живой ~/.craft-agent).
 */
const parseBunfigPreloads = (text: string): { topLevel: string[]; test: string[] } => {
  const src = text
    .split('\n')
    .map((l) => l.replace(/#.*$/, ''))
    .join('\n')
  const grabAfter = (anchor: RegExp, haystack: string): string[] => {
    const m = haystack.match(anchor)
    if (!m || m.index === undefined) return []
    const start = haystack.indexOf('[', m.index)
    const end = haystack.indexOf(']', start)
    if (start < 0 || end < 0) return []
    return [...haystack.slice(start + 1, end).matchAll(/"([^"]+)"/g)].map((x) => x[1])
  }
  const topLevel = grabAfter(/^preload\s*=\s*\[/m, src)
  const testSection = src.match(/^\[test\]\s*$/m)
  const test =
    testSection && testSection.index !== undefined
      ? grabAfter(/^preload\s*=\s*\[/m, src.slice(testSection.index))
      : []
  return { topLevel, test }
}

const checkBunfigParity = (): void => {
  const rootBunfig = join(ROOT, 'bunfig.toml')
  if (!existsSync(rootBunfig)) return
  const rootCfg = parseBunfigPreloads(readText(rootBunfig))
  // Нормализация путей: у корня ведущий "./", у пакетов префикс "../../".
  const norm = (p: string): string => p.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '')
  const rootTestKey = rootCfg.test.map(norm).join('|')
  const rootTopKey = rootCfg.topLevel.map(norm).join('|')
  for (const dirName of ['packages', 'apps']) {
    const base = join(ROOT, dirName)
    if (!existsSync(base)) continue
    for (const name of readdirSync(base)) {
      const bf = join(base, name, 'bunfig.toml')
      if (!existsSync(bf)) continue
      const cfg = parseBunfigPreloads(readText(bf))
      if (cfg.test.map(norm).join('|') !== rootTestKey) {
        error(`${rel(bf)}: [test].preload расходится с корневым bunfig`)
      }
      if (cfg.topLevel.map(norm).join('|') !== rootTopKey) {
        error(`${rel(bf)}: верхнеуровневый preload расходится с корневым bunfig`)
      }
    }
  }
}


const main = (): number => {
  const files = collectYamlSources()
  const entries = loadEntries(files)
  checkRefsAndPaths(entries)
  const docCount = checkDocuments()
  checkBunfigParity()
  printReport(files.length, entries.length, docCount)
  return errors.length > 0 ? 1 : 0
}

try {
  process.exit(main())
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err)
  console.error(`Внутренняя ошибка валидатора: ${reason}`)
  process.exit(1)
}
