#!/usr/bin/env bun
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, chmod, writeFile } from 'node:fs/promises'
import path from 'node:path'

type Issue = {
  id: string
  title: string
  area: string
  kind: string
  sourceRefs: string[]
  dependsOn: string[]
  body: string
}
type RemoteIssue = {
  number: number
  title: string
  body: string | null
  html_url: string
  state: string
  labels: Array<{ name: string }>
  pull_request?: unknown
}
type Options = { mode: string; repo: string; docsRef: string; output: string; allowPublish: boolean }
// --repo selects the local checkout only; all GitHub operations target GH_REPO.
const GH_REPO = 'rox-one/rox-one'
const MARKER_PREFIX = '<!-- sep-program:20260930:'
const BODY_LIMIT = 65_536
const PAGE_LIMIT = 100
const PAGE_COUNT_LIMIT = 100
const TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

function fail(message: string): never { throw new Error(message) }
function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }
function marker(issue: Issue): string { return `${MARKER_PREFIX}${issue.id} -->` }
function parseArgs(args: string[]): Options {
  const values = new Map<string, string>()
  let allowPublish = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--allow-publish') { allowPublish = true; continue }
    if (!['--mode', '--repo', '--docs-ref', '--output'].includes(arg)) fail(`Unknown argument: ${arg}`)
    const value = args[++i]
    if (!value || value.startsWith('--')) fail(`Missing value for ${arg}`)
    values.set(arg, value)
  }
  const mode = values.get('--mode')
  if (!['validate', 'dry-run', 'publish', 'verify'].includes(mode ?? '')) fail('--mode must be validate, dry-run, publish, or verify')
  const repo = path.resolve(values.get('--repo') ?? '')
  const docsRef = values.get('--docs-ref')
  const output = path.resolve(values.get('--output') ?? '')
  if (!values.has('--repo') || !values.has('--docs-ref') || !values.has('--output')) fail('--repo must be the local checkout path; GitHub target is fixed separately in GH_REPO. --docs-ref and --output are also required')
  if (mode === 'publish' && !allowPublish) fail('publish requires explicit --allow-publish')
  if (mode !== 'publish' && allowPublish) fail('--allow-publish is valid only with --mode publish')
  return { mode: mode!, repo, docsRef: docsRef!, output, allowPublish }
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 }
function normalizeHeading(value: string): string { return value.toLocaleLowerCase('ru').replace(/[ё]/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim() }
const requiredHeadingVariants = [
  ['prd', 'контекст', 'context', 'problem statement', 'проблема', 'пользователь'],
  ['sources', 'source', 'источники', 'provenance', 'происхождение', 'sources and evidence'],
  ['требован', 'requirement', 'specification', 'спецификац'],
  ['as is to be', 'as is -> to be', 'as is — to be', 'as is', 'current target', 'текущее состояние', 'как есть', 'было должно стать', 'сейчас результат'],
  ['ui ux', 'ui/ux', 'ui взаимодействия', 'ui план', 'plan ui', 'план ui', 'интерфейс пользователя', 'ui implementation', 'пользовательский интерфейс'],
  ['deep functional tests', 'functional tests', 'functional test cases', 'functional checks', 'functional scenarios', 'deep acceptance scenarios', 'detailed tests', 'detailed scenarios', 'test matrix', 'verification scenarios', 'сценарии', 'подробная функциональная приемка', 'подробная функциональная приёмка', 'исполняемые acceptance tests', 'глубокие функциональные тесты', 'глубокие функциональные проверки', 'функциональные тесты', 'функциональные проверки', 'детальные функциональные проверки', 'подробные функциональные проверки', 'функциональные сценарии', 'детальные сценарии', 'подробные сценарии', 'детальные проверки', 'подробные проверки'],
  ['dod', 'definition of done', 'acceptance criteria', 'acceptance requirements', 'acceptance checks', 'критерии готовности', 'критерии завершения', 'критерии приемки', 'критерии приёмки', 'конкретная приемка', 'конкретная приёмка'],
  ['requirements', 'требования', 'specification', 'спецификация'],
  ['план', 'plan', 'implementation plan', 'next step', 'next action', 'следующий шаг'],
]
const validKinds: Record<string, true> = {
  'decision-reconciliation': true,
  'proposal-audit': true,
  requested: true,
  'verification-gap': true,
}
function substantiveSections(body: string): string[] {
  const lines = body.split(/\r?\n/)
  const headings = lines.map((line, index) => /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1] ? { index, title: normalizeHeading(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)![1]) } : null).filter((x): x is { index: number; title: string } => x !== null)
  const sections = requiredHeadingVariants.map(variants => {
    const matching = headings.find((heading, i) => {
      if (!variants.some(variant => heading.title.includes(normalizeHeading(variant)))) return false
      const end = headings[i + 1]?.index ?? lines.length
      const text = lines.slice(heading.index + 1, end).join('\n').replace(/<!--.*?-->/gs, '').replace(/[#>*_`\-[\]()]/g, ' ').replace(/https?:\/\/\S+/g, ' ').trim()
      return text.length >= 35 && text.split(/\s+/).length >= 6
    })
    return matching ? matching.index : -1
  })
  const missing = requiredHeadingVariants.filter((_, index) => sections[index] < 0).map(variants => variants[0])
  const distinct = new Map<number, number>()
  for (const index of sections.slice(3, 7).filter(index => index >= 0)) distinct.set(index, (distinct.get(index) ?? 0) + 1)
  if ([...distinct.values()].some(count => count > 1)) missing.push('distinct substantive UI/UX, As-is-to-be, functional-test, and DoD sections')
  return missing
}
let backlogAnchors: Record<string, string> = {}
async function loadIssues(root: string): Promise<Issue[]> {
  const dir = path.join(root, 'docs/september-program')
  const files = (await readdir(dir)).filter(file => /^issues-.*\.json$/.test(file)).sort()
  if (!files.length) fail(`No docs/september-program/issues-*.json inputs in ${dir}`)
  const issues: Issue[] = []
  const ids = new Set<string>()
  const backlog = await readFile(path.join(root, 'docs/september-program/source-backlog.md'), 'utf8')
  for (const match of backlog.matchAll(/^## (U\d{2})\s+(.+)$/gm)) {
    const slug = `${match[1]} ${match[2]}`.toLocaleLowerCase('en')
      .replace(/\s/g, '-')
      .replace(/[^\p{L}\p{N}_-]/gu, '')
    backlogAnchors[match[1]] = slug
  }
  for (const file of files) {
    let data: unknown
    try { data = JSON.parse(await readFile(path.join(dir, file), 'utf8')) } catch (error) { fail(`${file}: invalid JSON (${String(error)})`) }
    if (!Array.isArray(data)) fail(`${file}: expected a JSON array`)
    for (const [index, value] of data.entries()) {
      const at = `${file}[${index}]`
      if (!object(value)) fail(`${at}: expected an object`)
      const keys = ['id', 'title', 'area', 'kind', 'sourceRefs', 'dependsOn', 'body']
      const extras = Object.keys(value).filter(key => !keys.includes(key))
      const missing = keys.filter(key => !(key in value))
      if (extras.length || missing.length) fail(`${at}: unexpected fields (${extras.join(', ') || 'none'}), missing fields (${missing.join(', ') || 'none'})`)
      if (!nonempty(value.id) || !/^[A-Z0-9][A-Z0-9-]{1,63}$/.test(value.id)) fail(`${at}.id must be a 2-64 character uppercase identifier using A-Z, 0-9, and hyphens`)
      if (ids.has(value.id)) fail(`${at}: duplicate id ${value.id}`)
      ids.add(value.id)
      if (!nonempty(value.area) || !/^[a-z0-9][a-z0-9 /&-]{0,39}$/.test(value.area) || value.area !== value.area.trim()) fail(`${at}.area must be a trimmed, lowercase simple area name`)
      if (!nonempty(value.title)) fail(`${at}.title must be non-empty`)
      const titleTag = /^\[Sep-([a-z0-9][a-z0-9 /&-]{0,39})\]\s+\S/.exec(value.title)
      if (!titleTag || titleTag[1] !== value.area) fail(`${at}.title must begin with [Sep-${value.area}] matching the lowercase area exactly`)
      if (!nonempty(value.kind) || !Object.hasOwn(validKinds, value.kind)) fail(`${at}.kind must be one of: ${Object.keys(validKinds).join(', ')}`)
      for (const field of ['sourceRefs', 'dependsOn'] as const) {
        if (!Array.isArray(value[field]) || value[field].some(item => !nonempty(item))) fail(`${at}.${field} must be an array of non-empty strings`)
        if (new Set(value[field] as string[]).size !== (value[field] as string[]).length) fail(`${at}.${field} must not contain duplicates`)
      }
      if (!(value.sourceRefs as string[]).length) fail(`${at}.sourceRefs must not be empty`)
      if ((value.dependsOn as string[]).includes(value.id)) fail(`${at} cannot depend on itself`)
      if (!nonempty(value.body)) fail(`${at}.body must be non-empty markdown`)
      const missingSections = substantiveSections(value.body)
      if (missingSections.length) fail(`${at}.body is missing substantive sections: ${missingSections.join(', ')}`)
      const issue: Issue = { id: value.id, title: value.title.trim(), area: value.area, kind: value.kind, sourceRefs: value.sourceRefs, dependsOn: value.dependsOn, body: value.body.trim() }
      if (new TextEncoder().encode(issue.body).length > BODY_LIMIT) fail(`${at}.body exceeds GitHub's ${BODY_LIMIT}-byte limit`)
      issues.push(issue)
    }
  }
  const byId = new Map(issues.map(issue => [issue.id, issue]))
  for (const issue of issues) for (const dependency of issue.dependsOn) if (!byId.has(dependency)) fail(`${issue.id} has dangling dependency ${dependency}`)
  const state = new Map<string, number>()
  const visit = (id: string, stack: string[]) => {
    const current = state.get(id) ?? 0
    if (current === 1) fail(`Dependency cycle: ${[...stack, id].join(' -> ')}`)
    if (current === 2) return
    state.set(id, 1)
    for (const dependency of byId.get(id)!.dependsOn) visit(dependency, [...stack, id])
    state.set(id, 2)
  }
  for (const issue of issues) visit(issue.id, [])
  return issues
}
function docsUrl(docsRef: string, file: string): string {
  const ref = encodeURIComponent(docsRef).replace(/%2F/g, '/')
  return `https://github.com/${GH_REPO}/blob/${ref}/${file}`
}
function labels(issue: Issue): string[] { return [`[Sep-${issue.area}]`, 'September-program'] }
function sourceUrl(ref: string, docsRef: string): string | null {
  const existing = /^existing:#(\d+)$/.exec(ref)
  if (existing) return `https://github.com/${GH_REPO}/issues/${existing[1]}`
  const group = /^U(\d{2})$/.exec(ref)
  if (group) {
    const anchor = backlogAnchors[ref]
    if (!anchor) fail(`No public source-backlog heading found for ${ref}`)
    return `${docsUrl(docsRef, 'docs/september-program/source-backlog.md')}#${anchor}`
  }
  return null
}
function renderBody(issue: Issue, dependencyUrls: Map<string, string> | null, docsRef: string, allIssues: Issue[] = [issue]): string {
  const deps = issue.dependsOn.length
    ? issue.dependsOn.map(id => {
        const url = dependencyUrls?.get(id)
        return url ? `- [${id}](${url})` : `- ${id}`
      }).join('\n')
    : '- Нет.'
  const groups = issue.sourceRefs.filter(ref => /^U\d{2}$/.test(ref))
  const sources = issue.sourceRefs.map(ref => {
    const url = sourceUrl(ref, docsRef)
    const display = /^U\d{2}$/.test(ref) ? `${ref} — публичный раздел` : ref
    const sequences = /^seq\d+$/.test(ref) ? ` (координата источника; связанные группы: ${groups.join(', ') || 'группа не указана'})` : ''
    return `- ${url ? `[${display}](${url})` : display}${sequences}`
  }).join('\n')
  const docs = ['PRD.md', 'spec.md', 'plan.md', 'source-backlog.md'].map(file => `- [${file}](${docsUrl(docsRef, file === 'PRD.md' || file === 'source-backlog.md' ? `docs/september-program/${file}` : `docs/${file}`)})`).join('\n')
  const index = issue.id === 'PROGRAM-01'
    ? `\n\n## Реестр issue / Issue URL index\n${allIssues.map(item => `- ${item.id}: ${dependencyUrls?.get(item.id) ?? 'URL появится после создания issue'}`).join('\n')}`
    : ''
  const body = `${issue.body.trim()}${index}\n\n## Зависимости / Dependencies\n${deps}\n\n## Источники / Source coordinates\n${sources}\n\n## Документация / Program documentation\n${docs}\n\n## Доказательства / Evidence\nNOT_RUN\n\n${marker(issue)}`
  if (new TextEncoder().encode(body).length > BODY_LIMIT) fail(`${issue.id}: complete generated body exceeds GitHub's ${BODY_LIMIT}-byte limit`)
  return body
}
function issueManifest(issue: Issue, body: string) {
  return { id: issue.id, title: issue.title, area: issue.area, kind: issue.kind, sourceRefs: issue.sourceRefs, dependsOn: issue.dependsOn, labels: labels(issue), marker: marker(issue), bodySha256: hash(body), bodyBytes: new TextEncoder().encode(body).length }
}
function receiptFor(issue: Issue, remote: RemoteIssue, status = 'created') {
  return { number: remote.number, url: remote.html_url, status, titleSha256: hash(remote.title), bodySha256: hash(remote.body ?? ''), labelsSha256: hash(JSON.stringify(remote.labels.map(label => label.name).sort())) }
}
function assertReceipt(issue: Issue, remote: RemoteIssue, receipt: unknown) {
  if (!object(receipt) || !['created', 'creating', 'create-rejected'].includes(String(receipt.status))) fail(`${issue.id}: no publisher ownership receipt; refusing marked-issue takeover`)
  if (receipt.status === 'created' && (receipt.number !== remote.number || receipt.url !== remote.html_url)) fail(`${issue.id}: receipt number/URL mismatch`)
  const bodyHash = hash(remote.body ?? '')
  if (receipt.titleSha256 !== hash(remote.title) || (receipt.bodySha256 !== bodyHash && receipt.pendingBodySha256 !== bodyHash) || receipt.labelsSha256 !== hash(JSON.stringify(remote.labels.map(label => label.name).sort()))) fail(`${issue.id}: remote title/body/labels changed since receipt; preserving manual changes`)
}
async function privateDir(dir: string) { await mkdir(dir, { recursive: true, mode: 0o700 }); await chmod(dir, 0o700) }
async function atomicPrivateWrite(file: string, content: string) {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`
  await writeFile(tmp, content, { mode: 0o600 })
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}
async function writeDryRun(issues: Issue[], output: string, docsRef: string) {
  await privateDir(output)
  const issueDir = path.join(output, 'issues')
  await privateDir(issueDir)
  const entries = issues.map(issue => {
    const body = renderBody(issue, null, docsRef, issues)
    return issueManifest(issue, body)
  })
  for (const issue of issues) await atomicPrivateWrite(path.join(issueDir, `${issue.id}.md`), `# ${issue.title}\n\n${renderBody(issue, null, docsRef, issues)}\n`)
  await atomicPrivateWrite(path.join(output, 'manifest.json'), `${JSON.stringify({ repository: GH_REPO, docsRef, evidence: 'NOT_RUN', issues: entries }, null, 2)}\n`)
}
async function readBounded(stream: ReadableStream<Uint8Array>, limit = MAX_OUTPUT_BYTES): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) { await reader.cancel(); fail(`gh output exceeded ${limit} bytes`) }
    chunks.push(value)
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
  return output
}
async function gh(args: string[], input?: unknown): Promise<{ value: unknown; code: number; status: number | null; retryAfterMs: number | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn(['gh', 'api', ...(input === undefined ? [] : ['--include']), ...args], { stdin: input === undefined ? 'ignore' : 'pipe', stdout: 'pipe', stderr: 'pipe', signal: controller.signal })
    if (input !== undefined) { proc.stdin.write(JSON.stringify(input)); proc.stdin.end() }
    const [stdout, stderr, code] = await Promise.all([readBounded(proc.stdout), readBounded(proc.stderr, 64 * 1024), proc.exited])
    let output = new TextDecoder().decode(stdout)
    let status: number | null = null
    let retryAfterMs: number | null = null
    if (input !== undefined) {
      const boundary = output.indexOf('\r\n\r\n')
      if (boundary < 0) return { value: code === 0 ? 'gh --include response had no HTTP headers' : new TextDecoder().decode(stderr).slice(0, 2000), code: 1, status: null, retryAfterMs: null }
      const headers = output.slice(0, boundary)
      output = output.slice(boundary + 4)
      status = Number(/^HTTP\/\S+\s+(\d+)/m.exec(headers)?.[1]) || null
      const retryAfter = /^retry-after:\s*([^\r\n]+)/im.exec(headers)?.[1].trim()
      if (retryAfter) retryAfterMs = /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now())
      if (!Number.isFinite(retryAfterMs)) retryAfterMs = null
    }
    if (code !== 0) return { value: `${new TextDecoder().decode(stderr).slice(0, 1200)}${status ? ` (HTTP ${status}${retryAfterMs ? `, Retry-After ${retryAfterMs}ms` : ''})` : ''}`, code, status, retryAfterMs }
    try { return { value: JSON.parse(output), code, status, retryAfterMs } } catch { return { value: 'gh returned invalid JSON', code: 1, status, retryAfterMs } }
  } catch (error) {
    return { value: error instanceof Error ? error.message : String(error), code: 124, status: null, retryAfterMs: null }
  } finally { clearTimeout(timer) }
}
async function verifyPublishedDocs(opts: Options) {
  const ref = await gh([`repos/${GH_REPO}/commits/${encodeURIComponent(opts.docsRef)}`])
  if (ref.code !== 0 || !object(ref.value) || typeof ref.value.sha !== 'string') fail(`Public documentation ref ${opts.docsRef} cannot be resolved`)
  const files = (await readdir(path.join(opts.repo, 'docs/september-program'))).filter(file => /\.(md|json)$/.test(file)).map(file => `docs/september-program/${file}`)
  files.push('docs/spec.md', 'docs/plan.md', 'scripts/september-issues.ts')
  for (const file of files) {
    const bytes = await readFile(path.join(opts.repo, file))
    const expected = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
    const result = await gh([`repos/${GH_REPO}/contents/${file}?ref=${encodeURIComponent(ref.value.sha)}`])
    if (result.code !== 0 || !object(result.value) || result.value.sha !== expected) fail(`Public ${file} at ${opts.docsRef} is absent or differs from the exact local publication input`)
  }
  console.log(`Verified ${files.length} public documentation/script blobs at ${ref.value.sha}`)
}
let writeQueue = Promise.resolve()
let writeReadyAt = 0
async function writeRequest(args: string[], input: unknown, retryRateLimits = true): Promise<{ value: unknown; code: number; status: number | null; retryAfterMs: number | null }> {
  let release!: () => void
  const previous = writeQueue
  writeQueue = new Promise<void>(resolve => { release = resolve })
  await previous
  try {
    for (let attempt = 0; ; attempt++) {
      const wait = Math.max(0, writeReadyAt - Date.now())
      if (wait) await Bun.sleep(wait)
      const result = await gh(args, input)
      const limited = result.status === 403 || result.status === 429
      writeReadyAt = Math.max(Date.now() + 1100, limited ? Date.now() + (result.retryAfterMs ?? 1000 * 2 ** attempt) : 0)
      if (result.code === 0 || !retryRateLimits || !limited || attempt >= 4) return result
    }
  } finally { release() }
}
function endpoint(page: number) { return `repos/${GH_REPO}/issues?state=all&per_page=${PAGE_LIMIT}&page=${page}` }
async function inventory(): Promise<RemoteIssue[]> {
  const all: RemoteIssue[] = []
  for (let page = 1; page <= PAGE_COUNT_LIMIT; page++) {
    const result = await gh([endpoint(page)])
    if (result.code !== 0) fail(`Could not read GitHub issue inventory (exit ${result.code})`)
    if (!Array.isArray(result.value)) fail('GitHub issue inventory response was not an array')
    const rows = result.value as RemoteIssue[]
    all.push(...rows.filter(row => !row.pull_request))
    if (rows.length < PAGE_LIMIT) return all
  }
  fail(`GitHub issue inventory exceeded the ${PAGE_COUNT_LIMIT}-page safety bound`)
}
async function ensureLabels(issues: Issue[]) {
  const expected = [...new Set(issues.flatMap(labels))]
  const existing = new Map<string, Record<string, unknown>>()
  for (let page = 1; page <= PAGE_COUNT_LIMIT; page++) {
    const result = await gh([`repos/${GH_REPO}/labels?per_page=${PAGE_LIMIT}&page=${page}`])
    if (result.code !== 0 || !Array.isArray(result.value)) fail(`Could not read repository labels before publication (exit ${result.code})`)
    for (const label of result.value) if (object(label) && typeof label.name === 'string') existing.set(label.name, label)
    if (result.value.length < PAGE_LIMIT) break
    if (page === PAGE_COUNT_LIMIT) fail(`Repository label inventory exceeded the ${PAGE_COUNT_LIMIT}-page safety bound`)
  }
  for (const name of expected) {
    if (existing.has(name)) continue
    const result = await writeRequest([`repos/${GH_REPO}/labels`, '--method', 'POST', '--input', '-'], { name, color: '6f42c1', description: 'September 2026 implementation program' })
    if (result.code !== 0) fail(`Could not create label ${name}; HTTP ${result.status ?? 'unknown'}: ${String(result.value)}`)
  }
}
function matches(issues: RemoteIssue[], id: string): RemoteIssue[] {
  const needle = `${MARKER_PREFIX}${id} -->`
  const found = issues.filter(issue => (issue.body ?? '').includes(needle))
  if (found.some(issue => (issue.body ?? '').split(needle).length > 2)) fail(`One remote issue contains repeated idempotency markers for ${id}`)
  return found
}
function urlMap(issues: Issue[], remote: RemoteIssue[]): Map<string, string> {
  const result = new Map<string, string>()
  for (const issue of issues) {
    const found = matches(remote, issue.id)
    if (found.length > 1) fail(`Multiple remote issues carry marker for ${issue.id}; refusing to continue`)
    if (found.length === 1) result.set(issue.id, found[0].html_url)
  }
  return result
}
async function withConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const item = items[next++]; await fn(item) }
  }))
}
async function saveReceipts(output: string, receipts: Map<string, unknown>) {
  await atomicPrivateWrite(path.join(output, 'receipts.json'), `${JSON.stringify({ repository: GH_REPO, receipts: Object.fromEntries(receipts) }, null, 2)}\n`)
}
async function publish(issues: Issue[], opts: Options) {
  await privateDir(opts.output)
  const receipts = new Map<string, unknown>()
  const receiptPath = path.join(opts.output, 'receipts.json')
  try {
    const prior = JSON.parse(await readFile(receiptPath, 'utf8'))
    if (object(prior.receipts)) for (const [id, receipt] of Object.entries(prior.receipts)) receipts.set(id, receipt)
  } catch { /* first run */ }
  let receiptWrites = Promise.resolve()
  const persistReceipts = () => {
    receiptWrites = receiptWrites.then(() => saveReceipts(opts.output, receipts))
    return receiptWrites
  }
  let remote = await inventory()
  for (const issue of issues) {
    const receipt = receipts.get(issue.id)
    if (!object(receipt) || receipt.status !== 'created') continue
    const owned = remote.find(item => item.number === receipt.number)
    if (!owned || !(owned.body ?? '').includes(marker(issue)) || owned.title !== issue.title) fail(`Created ownership receipt for ${issue.id} no longer matches its exact-title marker issue; refusing to create or update a replacement`)
  }
  const existing = urlMap(issues, remote)
  for (const issue of issues) {
    if (!existing.has(issue.id) && remote.some(item => item.title === issue.title)) fail(`An unmarked remote issue already has the authored title for ${issue.id}; refusing to duplicate or update it`)
    const prior = receipts.get(issue.id)
    if (!existing.has(issue.id) && object(prior) && prior.status === 'creating') fail(`${issue.id}: previous create outcome remains uncertain; refusing a second POST`)
  }
  for (const issue of issues) {
    const found = matches(remote, issue.id)
    if (found.length === 1) {
      if (found[0].title !== issue.title) fail(`Remote marker for ${issue.id} has conflicting title; refusing to update`)
      const prior = receipts.get(issue.id)
      assertReceipt(issue, found[0], prior)
      receipts.set(issue.id, receiptFor(issue, found[0]))
    }
  }
  await persistReceipts()
  await ensureLabels(issues)
  const toCreate = issues.filter(issue => !existing.has(issue.id))
  await withConcurrency(toCreate, 3, async issue => {
    const body = renderBody(issue, null, opts.docsRef, issues)
    const payload = { title: issue.title, body, labels: labels(issue) }
    receipts.set(issue.id, { status: 'creating', titleSha256: hash(issue.title), bodySha256: hash(body), labelsSha256: hash(JSON.stringify(labels(issue).sort())) })
    await persistReceipts()
    let result = await writeRequest([`repos/${GH_REPO}/issues`, '--method', 'POST', '--input', '-'], payload, false)
    for (let attempt = 0; result.code !== 0 && attempt < 2; attempt++) {
      if (result.status !== null && result.status !== 403 && result.status !== 429) break
      if (result.status === 403 || result.status === 429) {
        const intent = receipts.get(issue.id)
        if (object(intent)) receipts.set(issue.id, { ...intent, status: 'create-rejected', rejectedHttpStatus: result.status })
        await persistReceipts()
      }
      const cooldown = Math.max(0, writeReadyAt - Date.now())
      if (cooldown) await Bun.sleep(cooldown)
      remote = await inventory()
      const found = matches(remote, issue.id)
      if (found.length > 1) fail(`Multiple remote issues carry marker for ${issue.id}; refusing retry`)
      if (found.length === 1) {
        assertReceipt(issue, found[0], receipts.get(issue.id))
        result = { value: found[0], code: 0, status: 200, retryAfterMs: null }
        break
      }
      if (attempt === 1 || result.status === null) break
      receipts.set(issue.id, { status: 'creating', titleSha256: hash(issue.title), bodySha256: hash(body), labelsSha256: hash(JSON.stringify(labels(issue).sort())) })
      await persistReceipts()
      result = await writeRequest([`repos/${GH_REPO}/issues`, '--method', 'POST', '--input', '-'], payload, false)
    }
    if (result.code !== 0 || !object(result.value) || typeof result.value.number !== 'number' || typeof result.value.html_url !== 'string') fail(`GitHub did not confirm create for ${issue.id} (HTTP ${result.status ?? 'unknown'}): ${String(result.value)}; receipt retained for safe resume`)
    const created = result.value as unknown as RemoteIssue
    assertReceipt(issue, created, receipts.get(issue.id))
    receipts.set(issue.id, receiptFor(issue, created))
    await persistReceipts()
  })
  remote = await inventory()
  const urls = urlMap(issues, remote)
  for (const issue of issues) if (!urls.has(issue.id)) fail(`No GitHub URL resolved for ${issue.id}; refusing dependency-link pass`)
  const ownedIds = new Set(issues.filter(issue => urls.has(issue.id)).map(issue => issue.id))
  await withConcurrency(issues.filter(issue => ownedIds.has(issue.id)), 3, async issue => {
    const current = matches(remote, issue.id)
    if (current.length !== 1 || current[0].title !== issue.title) fail(`Expected one exact-title owned issue for ${issue.id}`)
    assertReceipt(issue, current[0], receipts.get(issue.id))
    const body = renderBody(issue, urls, opts.docsRef, issues)
    if (body !== current[0].body) {
      const prior = receipts.get(issue.id)
      if (!object(prior)) fail(`${issue.id}: missing ownership receipt before PATCH`)
      receipts.set(issue.id, { ...prior, pendingBodySha256: hash(body) })
      await persistReceipts()
      const result = await writeRequest([`repos/${GH_REPO}/issues/${current[0].number}`, '--method', 'PATCH', '--input', '-'], { body })
      if (result.code !== 0) fail(`Could not resolve dependency links for ${issue.id} (HTTP ${result.status ?? 'unknown'}): ${String(result.value)}; receipt retained for safe resume`)
    }
    receipts.set(issue.id, receiptFor(issue, { ...current[0], body }))
    await persistReceipts()
  })
  remote = await inventory()
  verifyIssues(issues, remote, opts.docsRef)
  for (const issue of issues) {
    const match = matches(remote, issue.id)[0]
    receipts.set(issue.id, receiptFor(issue, match))
  }
  await persistReceipts()
}
function verifyIssues(issues: Issue[], remote: RemoteIssue[], docsRef: string) {
  const urls = urlMap(issues, remote)
  const errors: string[] = []
  for (const issue of issues) {
    const found = matches(remote, issue.id)
    if (found.length !== 1) { errors.push(`${issue.id}: expected exactly one marker match, found ${found.length}`); continue }
    const item = found[0]
    const expectedBody = renderBody(issue, urls, docsRef, issues)
    const expectedLabels = labels(issue).sort()
    const actualLabels = item.labels.map(label => label.name).sort()
    if (item.title !== issue.title) errors.push(`${issue.id}: title mismatch`)
    if ((item.body ?? '') !== expectedBody) errors.push(`${issue.id}: body/hash mismatch (expected ${hash(expectedBody)}, actual ${hash(item.body ?? '')})`)
    if (JSON.stringify(actualLabels) !== JSON.stringify(expectedLabels)) errors.push(`${issue.id}: labels mismatch`)
  }
  if (errors.length) fail(`Remote verification failed:\n${errors.join('\n')}`)
}
async function main() {
  const opts = parseArgs(Bun.argv.slice(2))
  const issues = await loadIssues(opts.repo)
  if (opts.mode === 'validate') { console.log(`Validated ${issues.length} issues; dependencies are acyclic.`); return }
  if (opts.mode === 'dry-run') { await writeDryRun(issues, opts.output, opts.docsRef); console.log(`Dry-run manifest and ${issues.length} markdown issues written to ${opts.output}`); return }
  const remote = await inventory()
  if (opts.mode === 'verify') { verifyIssues(issues, remote, opts.docsRef); console.log(`Verified ${issues.length} remote issues by exact title, body hash/content, and labels.`); return }
  await verifyPublishedDocs(opts)
  await publish(issues, opts)
  console.log(`Published or reconciled ${issues.length} issues and verified exact remote content; receipts: ${path.join(opts.output, 'receipts.json')}`)
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
