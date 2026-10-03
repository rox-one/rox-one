import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
const MAX_SOURCE_BYTES = 32 * 1024 * 1024
const MAX_PATHS = 10_000
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
function git(root: string, args: string[], allowMissing = false): Buffer {
  const result = Bun.spawnSync(['git', '--no-pager', ...args], { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1' }, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0 && !allowMissing) throw new Error('GIT_READ_FAILED')
  return result.stdout
}
function safeSource(root: string, path: string): Buffer {
  if (!path || isAbsolute(path) || path.includes('\\') || path.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('INVALID_SOURCE_PATH')
  const target = resolve(root, path)
  const rel = relative(root, target)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('SOURCE_PATH_ESCAPE')
  let cursor = root
  for (const part of rel.split(sep)) { cursor = join(cursor, part); if (lstatSync(cursor).isSymbolicLink()) throw new Error('SOURCE_SYMLINK_UNVERIFIED') }
  const stat = lstatSync(target)
  if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) throw new Error('UNSUPPORTED_SOURCE_FILE')
  const source = readFileSync(target)
  if (source.length !== stat.size) throw new Error('SOURCE_CHANGED')
  return source
}
export function collectGitLineage(options: { root: string; paths: string[] }) {
  if (!options.paths.length || options.paths.length > MAX_PATHS || new Set(options.paths).size !== options.paths.length) throw new Error('INVALID_SOURCE_SET')
  const root = realpathSync(options.root)
  const head = git(root, ['rev-parse', 'HEAD']).toString('utf8').trim()
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('UNSUPPORTED_GIT_OBJECT_FORMAT')
  const remotes = git(root, ['config', '--get-regexp', '^remote\..*\.url$'], true).toString('utf8').trim().split('\n').filter(Boolean).map(row => {
    const space = row.indexOf(' ')
    const name = row.slice(0, space)
    const value = row.slice(space + 1)
    if (/^https?:\/\//.test(value)) { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return { name, url: url.href } }
    return { name, url: value.replace(/^[^@]+@/, '[ssh-user]@') }
  })
  const rows = options.paths.sort().map(path => {
    const source = safeSource(root, path)
    const tree = git(root, ['ls-tree', '-z', head, '--', path]).toString('utf8').split('\0').filter(Boolean)
    const record = tree.find(value => value.slice(value.indexOf('\t') + 1) === path)
    const match = record?.match(/^([0-9]+) blob ([a-f0-9]{40})\t/)
    const blob = match?.[2]
    const base = blob ? git(root, ['cat-file', 'blob', blob]) : null
    const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', path]).toString('utf8').split('\0').filter(Boolean).map(value => value.slice(0, 2))
    const history = blob ? git(root, ['log', '--follow', '--format=%H %aI', '--max-count=10', head, '--', path]).toString('utf8').trim().split('\n').filter(Boolean) : []
    const diff = blob ? git(root, ['diff', '--no-ext-diff', '--no-textconv', '--binary', head, '--', path]) : Buffer.alloc(0)
    return { path, currentSha256: sha256(source), currentBytes: source.length, headBlob: blob ?? null, headSha256: base ? sha256(base) : null, headBytes: base?.length ?? null, matchesHead: base ? base.equals(source) : false, status, history, diffSha256: diff.length ? sha256(diff) : null, diffBytes: diff.length, originState: blob ? 'TRACKED_ROX_BASE_AND_CURRENT_READBACK' : 'NEW_SOURCE_WITHOUT_GIT_HISTORY', legalReview: 'LICENSE_REVIEW_REQUIRED' }
  })
  if (git(root, ['rev-parse', 'HEAD']).toString('utf8').trim() !== head) throw new Error('HEAD_CHANGED')
  for (const row of rows) if (sha256(safeSource(root, row.path)) !== row.currentSha256) throw new Error('SOURCE_CHANGED')
  return { schemaVersion: 1, evidenceKind: 'GIT_SOURCE_LINEAGE_INPUTS', head, remotes, files: rows, dirtySourceCount: rows.filter(row => !row.matchesHead).length, legalApproval: false, upstreamCopyHistoryVerified: false, limits: ['Git history and remote identity are evidence, not qualified origin approval.', 'Untracked files have no Git commit lineage; worker/author provenance requires separate accepted evidence.', 'History is bounded to ten commits per scoped input; complete copied/vendor ancestry may require further review.', 'Only explicitly scoped build inputs/notices/manifests are read; unrelated workspace state is not treated as release provenance.'] }
}
