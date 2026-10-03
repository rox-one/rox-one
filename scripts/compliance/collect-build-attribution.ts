#!/usr/bin/env bun
/** Read-only build attribution evidence. Does not issue license decisions or domain commands. */
import { createHash } from 'node:crypto'
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_INPUTS = 100_000
const MAX_NOTICE_ENTRIES = 100_000
type ObjectValue = Record<string, unknown>
type Finding = { code: string; subject: string }
type Input = { path: string; sha256: string; bytes: number; bytesInOutput: number; packageRoot: string; imports: unknown[] }
type Notice = { path: string; sha256: string; bytes: number; text: string }
type Package = { root: string; name: string; version: string; manifestSha256: string; licenseDeclaration: unknown; repositoryDeclaration: unknown; lockMatches: { key: string; row: unknown[] }[]; workspaceLock: unknown; notices: Notice[]; inputs: Input[]; findings: Finding[] }
export const digest = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
function object(value: unknown, subject: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_OBJECT:' + subject)
  return value as ObjectValue
}
function text(value: unknown, subject: string): string {
  if (typeof value !== 'string' || !value) throw new Error('INVALID_TEXT:' + subject)
  return value
}
function count(value: unknown, subject: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_BYTE_COUNT:' + subject)
  return value
}
function inside(root: string, path: string): string {
  const target = resolve(path)
  const rel = relative(root, target)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('PATH_ESCAPE')
  let cursor = root
  for (const part of rel.split(sep).filter(Boolean)) {
    cursor = join(cursor, part)
    if (lstatSync(cursor).isSymbolicLink()) throw new Error('SYMLINK_INPUT_UNVERIFIED')
  }
  return target
}
function bytes(path: string): Buffer {
  const stat = lstatSync(path, { bigint: true })
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > BigInt(MAX_FILE_BYTES)) throw new Error('UNSUPPORTED_FILE')
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = fstatSync(fd, { bigint: true })
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) throw new Error('SOURCE_CHANGED')
    const result = readFileSync(fd)
    const after = fstatSync(fd, { bigint: true })
    if (after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs || result.length !== Number(after.size)) throw new Error('SOURCE_CHANGED')
    return result
  } finally { closeSync(fd) }
}
function json(path: string): unknown { return JSON.parse(bytes(path).toString('utf8')) }
function packageRoot(root: string, input: string): string {
  let cursor = dirname(input)
  while (true) {
    if (existsSync(join(cursor, 'package.json'))) return cursor
    if (cursor === root) throw new Error('PACKAGE_MANIFEST_MISSING')
    const parent = dirname(cursor)
    if (parent === cursor) throw new Error('PACKAGE_MANIFEST_MISSING')
    cursor = parent
  }
}
function notices(root: string, packagePath: string): { notices: Notice[]; findings: Finding[] } {
  const result: Notice[] = []
  const findings: Finding[] = []
  let visited = 0
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++visited > MAX_NOTICE_ENTRIES) throw new Error('NOTICE_ENTRY_LIMIT')
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) { findings.push({ code: 'PACKAGE_SYMLINK_UNVERIFIED', subject: relative(root, path) }); continue }
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && /^(?:licen[cs]es?|notices?|copying|copyright|third[-_]?party[-_]?licen[cs]es|third[-_]?party[-_]?notices)(?:[._-].*)?$/i.test(entry.name)) {
        const source = bytes(inside(root, path))
        result.push({ path: relative(root, path), sha256: digest(source), bytes: source.length, text: new TextDecoder('utf-8', { fatal: true }).decode(source) })
      }
    }
  }
  // Workspace scope inherits root notices; scanning the whole workspace source tree would include unrelated products.
  if (!relative(root, packagePath).split(sep).includes('node_modules')) {
    for (const path of [join(root, 'LICENSE'), join(root, 'NOTICE'), join(packagePath, 'LICENSE'), join(packagePath, 'NOTICE')]) {
      if (!existsSync(path) || result.some(row => row.path === relative(root, path))) continue
      const source = bytes(inside(root, path))
      result.push({ path: relative(root, path), sha256: digest(source), bytes: source.length, text: new TextDecoder('utf-8', { fatal: true }).decode(source) })
    }
    findings.push({ code: 'WORKSPACE_SOURCE_ORIGIN_REVIEW_REQUIRED', subject: relative(root, packagePath) })
  } else walk(packagePath)
  if (!result.length) findings.push({ code: 'LICENSE_TEXT_MISSING', subject: relative(root, packagePath) })
  return { notices: result.sort((a, b) => a.path.localeCompare(b.path)), findings }
}
export function collect(options: { root: string; buildCwd: string; outputRoot: string; metafile: string; lock: string; toolsRoot?: string }) {
  const root = realpathSync(options.root)
  const buildCwd = inside(root, resolve(options.buildCwd))
  const outputRoot = inside(root, resolve(options.outputRoot))
  const metaBytes = bytes(inside(root, resolve(options.metafile)))
  const meta = object(JSON.parse(metaBytes.toString('utf8')), 'metafile')
  const graphInputs = object(meta.inputs, 'inputs')
  const graphOutputs = object(meta.outputs, 'outputs')
  if (Object.keys(graphInputs).length > MAX_INPUTS || !Object.keys(graphOutputs).length) throw new Error('UNSUPPORTED_GRAPH_SIZE')
  const lockBytes = bytes(inside(root, resolve(options.lock)))
  const require = createRequire(options.toolsRoot ? join(options.toolsRoot, 'package.json') : import.meta.url)
  const ts = object(require('typescript') as unknown, 'typescript')
  if (typeof ts.parseConfigFileTextToJson !== 'function') throw new Error('LOCK_PARSER_UNAVAILABLE')
  const parse = ts.parseConfigFileTextToJson as (path: string, source: string) => { config: unknown; error?: unknown }
  const parsed = parse('bun.lock', lockBytes.toString('utf8'))
  if (parsed.error) throw new Error('INVALID_LOCK')
  const lock = object(parsed.config, 'lock')
  const lockPackages = object(lock.packages, 'lock packages')
  const workspaces = object(lock.workspaces, 'lock workspaces')
  const contributions = new Map<string, number>()
  const outputs: { path: string; bytes: number; sha256: string; imports: unknown[] }[] = []
  const findings: Finding[] = []
  for (const [key, value] of Object.entries(graphOutputs)) {
    const output = object(value, key)
    const physical = inside(root, resolve(outputRoot, key))
    const source = bytes(physical)
    if (source.length !== count(output.bytes, key)) throw new Error('OUTPUT_SIZE_MISMATCH:' + key)
    if (!Array.isArray(output.imports)) throw new Error('INVALID_OUTPUT_IMPORTS')
    outputs.push({ path: relative(root, physical), bytes: source.length, sha256: digest(source), imports: output.imports })
    for (const [inputKey, inputValue] of Object.entries(object(output.inputs, 'output inputs'))) {
      if (!(inputKey in graphInputs)) throw new Error('OUTPUT_INPUT_UNKNOWN:' + inputKey)
      const emitted = count(object(inputValue, inputKey).bytesInOutput, inputKey)
      contributions.set(inputKey, (contributions.get(inputKey) ?? 0) + emitted)
    }
  }
  const packages = new Map<string, Package>()
  for (const [key, value] of Object.entries(graphInputs).sort(([a], [b]) => a.localeCompare(b))) {
    const input = object(value, key)
    const physical = inside(root, resolve(buildCwd, key))
    const source = bytes(physical)
    if (source.length !== count(input.bytes, key)) throw new Error('INPUT_SIZE_MISMATCH:' + key)
    if (!Array.isArray(input.imports)) throw new Error('INVALID_INPUT_IMPORTS')
    const pkgRoot = packageRoot(root, physical)
    const packagePath = relative(root, pkgRoot)
    let pkg = packages.get(packagePath)
    if (!pkg) {
      const manifestBytes = bytes(inside(root, join(pkgRoot, 'package.json')))
      const manifest = object(JSON.parse(manifestBytes.toString('utf8')), 'package manifest')
      const name = text(manifest.name, 'package name')
      const version = text(manifest.version, 'package version')
      const installed = packagePath.split(sep).includes('node_modules')
      const matches = Object.entries(lockPackages).flatMap(([lockKey, row]) => Array.isArray(row) && row[0] === name + '@' + version ? [{ key: lockKey, row }] : [])
      const evidence = notices(root, pkgRoot)
      pkg = { root: packagePath, name, version, manifestSha256: digest(manifestBytes), licenseDeclaration: manifest.license ?? null, repositoryDeclaration: manifest.repository ?? null, lockMatches: matches, workspaceLock: installed ? null : workspaces[packagePath] ?? null, notices: evidence.notices, inputs: [], findings: evidence.findings }
      if (installed && matches.length !== 1) pkg.findings.push({ code: matches.length ? 'LOCK_LOCATOR_AMBIGUOUS' : 'LOCK_LOCATOR_MISSING', subject: packagePath })
      if (!installed && !pkg.workspaceLock) pkg.findings.push({ code: 'WORKSPACE_LOCK_MISSING', subject: packagePath })
      if (installed) pkg.findings.push({ code: 'REGISTRY_ARCHIVE_INTEGRITY_NOT_READ_BACK', subject: packagePath })
      if (!manifest.license) pkg.findings.push({ code: 'LICENSE_DECLARATION_MISSING', subject: packagePath })
      packages.set(packagePath, pkg)
    }
    pkg.inputs.push({ path: relative(root, physical), sha256: digest(source), bytes: source.length, bytesInOutput: contributions.get(key) ?? 0, packageRoot: packagePath, imports: input.imports })
  }
  for (const pkg of packages.values()) findings.push(...pkg.findings)
  return { schemaVersion: 1, evidenceKind: 'BUNDLED_ATTRIBUTION_INPUTS', legalReview: 'LICENSE_REVIEW_REQUIRED', legalApproval: false, buildCwd: relative(root, buildCwd), outputRoot: relative(root, outputRoot), metafileSha256: digest(metaBytes), lockSha256: digest(lockBytes), outputs, packages: [...packages.values()], findings, limits: ['Metafile is producer evidence; this collector does not authenticate the producer revision.', 'Input hashes prove current readback, not source hashes at build time; independent reproducibility remains required.', 'Manifest license/repository fields are declarations; exact accepted upstream source and history readback remain required.', 'Registry integrity is recorded from the lock, not verified against registry archive bytes.', 'Notice candidates are read from installed package scope; their applicability and completeness require scoped review.', 'Runtime builtin/optional dynamic dependencies require separate deployed-runtime evidence.'] }
}
export function noticeCandidates(evidence: ReturnType<typeof collect>): string {
  const sections = ['WORKSPACE SERVICE NOTICE CANDIDATES\n\nStatus: LICENSE_REVIEW_REQUIRED. No qualified approval or publication clearance.\nMetafile SHA256: ' + evidence.metafileSha256 + '\nLock SHA256: ' + evidence.lockSha256 + '\n']
  for (const pkg of evidence.packages.filter(row => row.inputs.some(input => input.bytesInOutput > 0))) {
    sections.push('\n============================================================\nComponent: ' + pkg.name + '@' + pkg.version + '\nInstalled scope: ' + pkg.root + '\nManifest declaration: ' + JSON.stringify(pkg.licenseDeclaration) + '\nEmitted contribution reported by producer: ' + pkg.inputs.reduce((sum, input) => sum + input.bytesInOutput, 0) + ' bytes\n')
    for (const notice of pkg.notices) sections.push('\n--- ' + notice.path + ' (SHA256 ' + notice.sha256 + ') ---\n' + notice.text + '\n')
    if (!pkg.notices.length) sections.push('\nUNRESOLVED: no installed license/notice text found.\n')
  }
  return sections.join('')
}
if (import.meta.main) {
  try {
    const { values } = parseArgs({ options: { root: { type: 'string' }, 'build-cwd': { type: 'string' }, 'output-root': { type: 'string' }, 'tools-root': { type: 'string' }, metafile: { type: 'string' }, lock: { type: 'string' }, output: { type: 'string' } }, strict: true })
    const result = collect({ root: text(values.root, 'root'), buildCwd: text(values['build-cwd'], 'build-cwd'), outputRoot: text(values['output-root'], 'output-root'), metafile: text(values.metafile, 'metafile'), lock: text(values.lock, 'lock'), toolsRoot: values['tools-root'] })
    const output = resolve(text(values.output, 'output'))
    const root = realpathSync(text(values.root, 'root'))
    if (!relative(root, output).startsWith('..' + sep) || !relative(root, realpathSync(dirname(output))).startsWith('..' + sep)) throw new Error('OUTPUT_MUST_BE_OUTSIDE_CHECKOUT')
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    console.log(JSON.stringify({ state: 'ATTRIBUTION_INPUTS_COLLECTED', packages: result.packages.length, outputDigest: digest(bytes(output)), legalApproval: false }))
  } catch { console.error('ATTRIBUTION_COLLECTION_FAILED'); process.exitCode = 1 }
}
