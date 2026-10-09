/**
 * ROX Keeper — pure vault model for the «Секреты» screen.
 *
 * The Rox Keeper fabric stores one secret per vault item: the secret name is the
 * item key (matching `[A-Za-z0-9._-]{1,120}`) and the secret value is a JSON
 * document with the item fields
 * (`{type, title, username?, password?, url?, notes?, totp?, tags?, shared?}`).
 *
 * `fabric.infisical.listItems` returns that value already parsed, or
 * `{valueJson: null, raw: true}` for a secret that is not a Rox JSON document
 * (raw bytes are withheld). Those items are read-only in the UI.
 *
 * This module owns the mapping between the wire shape and the in-memory item,
 * plus validation, the space/folder tree derived from `listPaths`, search and
 * sort. No I/O lives here (see __tests__/keeper-surface.test.tsx).
 */

export const KEEPER_ITEM_TYPES = ['login', 'note', 'card', 'identity'] as const
export type KeeperItemType = (typeof KEEPER_ITEM_TYPES)[number]

/** Key charset/length accepted by `fabric.infisical.upsertItem`. */
export const KEEPER_KEY_RE = /^[A-Za-z0-9._-]{1,120}$/
/** Serialized value size cap enforced by `fabric.infisical.upsertItem`. */
export const VALUE_JSON_MAX_CHARS = 16_384

/** Wire shape stored as the secret value. `shared` is the «Поделиться с командой» flag. */
export interface KeeperItemValue {
  type: KeeperItemType
  title: string
  username?: string
  password?: string
  url?: string
  notes?: string
  totp?: string
  tags?: string[]
  /** true = shared with the organization; rights/capability sync is a layer above. */
  shared?: boolean
}

/** One entry as returned by `fabric.infisical.listItems`. */
export interface KeeperRawItem {
  key: string
  /** Parsed JSON document, or a JSON string (kept tolerated), or null for a raw secret. */
  valueJson?: unknown
  /** true = the stored secret is not a Rox JSON document; valueJson is withheld. */
  raw?: boolean
  updatedAt?: string | null
}

/** Parsed item bound to the folder path it was listed from. */
export interface KeeperItem {
  key: string
  path: string
  value: KeeperItemValue
  /** true = non-JSON secret: read-only in the UI, delete only. */
  raw: boolean
  updatedAt: string | null
}

/** Editor state. `key === null` marks an item that has never been saved. */
export interface KeeperDraft {
  key: string | null
  path: string
  type: KeeperItemType
  title: string
  username: string
  password: string
  url: string
  notes: string
  totp: string
  tagsText: string
  shared: boolean
  /** Mirrors `KeeperItem.raw`: the editor is read-only for these. */
  raw: boolean
}

export type KeeperIssueField = 'title' | 'url' | 'totp' | 'key' | 'value'

export interface KeeperIssue {
  field: KeeperIssueField
  /** i18n key surfaced to the user. */
  key: string
}

export interface KeeperFolder {
  path: string
  name: string
}

export type KeeperSpaceId = 'personal' | 'organization'

export interface KeeperSpace {
  id: KeeperSpaceId
  labelKey: string
  /** Secret path that holds the whole space. */
  root: string
  folders: KeeperFolder[]
}

/**
 * The two vault spaces. They are fixed (the customer names exactly «Личное» and
 * «Организация»); `listPaths` supplies the folders *inside* each space.
 */
export const KEEPER_SPACES: readonly { id: KeeperSpaceId; labelKey: string; root: string }[] = [
  { id: 'personal', labelKey: 'extraScreens.keeper.space.personal', root: '/personal' },
  { id: 'organization', labelKey: 'extraScreens.keeper.space.organization', root: '/organization' },
]

export function isKeeperItemType(value: unknown): value is KeeperItemType {
  return typeof value === 'string' && (KEEPER_ITEM_TYPES as readonly string[]).includes(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Split a comma-separated tag string, trim, drop blanks and dedupe case-insensitively. */
export function normalizeTags(input: string | readonly string[] | null | undefined): string[] {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of raw) {
    const tag = text(entry).trim()
    if (tag === '') continue
    const fingerprint = tag.toLowerCase()
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    out.push(tag)
  }
  return out
}

function parseBag(valueJson: unknown): Record<string, unknown> | null {
  if (typeof valueJson === 'string') {
    if (valueJson.trim() === '') return null
    try {
      const parsed: unknown = JSON.parse(valueJson)
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  if (typeof valueJson === 'object' && valueJson !== null && !Array.isArray(valueJson)) {
    return valueJson as Record<string, unknown>
  }
  return null
}

/**
 * Parse a stored item value (parsed Record from the bridge, or a JSON string)
 * into a value. Malformed input yields an empty note — never a throw, so a
 * hand-edited vault secret cannot break the whole pane.
 */
export function parseItemValue(valueJson: unknown): KeeperItemValue {
  const fallback: KeeperItemValue = { type: 'note', title: '' }
  const bag = parseBag(valueJson)
  if (!bag) return fallback
  const value: KeeperItemValue = {
    type: isKeeperItemType(bag.type) ? bag.type : 'note',
    title: text(bag.title).trim(),
  }
  const username = text(bag.username).trim()
  if (username !== '') value.username = username
  const password = text(bag.password)
  if (password !== '') value.password = password
  const url = text(bag.url).trim()
  if (url !== '') value.url = url
  const notes = text(bag.notes)
  if (notes !== '') value.notes = notes
  const totp = text(bag.totp).trim()
  if (totp !== '') value.totp = totp
  const tags = normalizeTags(Array.isArray(bag.tags) ? (bag.tags as unknown[]).map(text) : [])
  if (tags.length > 0) value.tags = tags
  if (bag.shared === true) value.shared = true
  return value
}

/**
 * Serialize a value to canonical JSON. Text fields are trimmed except
 * `password`/`notes`, where surrounding whitespace can be meaningful. Empty
 * optionals and `shared: false` are omitted so the stored document stays small.
 */
export function serializeItemValue(value: KeeperItemValue): string {
  const out: Record<string, unknown> = {
    type: isKeeperItemType(value.type) ? value.type : 'note',
    title: text(value.title).trim(),
  }
  const putTrimmed = (key: string, raw: unknown): void => {
    const entry = text(raw).trim()
    if (entry !== '') out[key] = entry
  }
  const putRaw = (key: string, raw: unknown): void => {
    const entry = text(raw)
    if (entry !== '') out[key] = entry
  }
  putTrimmed('username', value.username)
  putRaw('password', value.password)
  putTrimmed('url', value.url)
  putRaw('notes', value.notes)
  putTrimmed('totp', value.totp)
  const tags = normalizeTags(value.tags)
  if (tags.length > 0) out.tags = tags
  if (value.shared === true) out.shared = true
  return JSON.stringify(out)
}

export function itemFromRaw(raw: KeeperRawItem, path: string): KeeperItem {
  const isRaw = raw?.raw === true
  return {
    key: text(raw?.key),
    path: normalizeSecretPath(path),
    value: isRaw ? { type: 'note', title: '' } : parseItemValue(raw?.valueJson),
    raw: isRaw,
    updatedAt: raw?.updatedAt == null ? null : String(raw.updatedAt),
  }
}

/** shared flag → i18n key for the «личный / расшарен» badge. */
export function shareStateKey(shared: boolean | undefined): string {
  return shared === true ? 'extraScreens.keeper.badge.shared' : 'extraScreens.keeper.badge.personal'
}

export function emptyDraft(path: string, type: KeeperItemType = 'login'): KeeperDraft {
  return {
    key: null,
    path: normalizeSecretPath(path),
    type,
    title: '',
    username: '',
    password: '',
    url: '',
    notes: '',
    totp: '',
    tagsText: '',
    shared: false,
    raw: false,
  }
}

export function draftFromItem(item: KeeperItem): KeeperDraft {
  const value = item.value
  return {
    key: item.key,
    path: item.path,
    type: value.type,
    title: value.title,
    username: value.username ?? '',
    password: value.password ?? '',
    url: value.url ?? '',
    notes: value.notes ?? '',
    totp: value.totp ?? '',
    tagsText: (value.tags ?? []).join(', '),
    shared: value.shared === true,
    raw: item.raw,
  }
}

export function valueFromDraft(draft: KeeperDraft): KeeperItemValue {
  const value: KeeperItemValue = {
    type: isKeeperItemType(draft.type) ? draft.type : 'note',
    title: draft.title.trim(),
  }
  if (draft.username.trim() !== '') value.username = draft.username.trim()
  if (draft.password !== '') value.password = draft.password
  if (draft.url.trim() !== '') value.url = draft.url.trim()
  if (draft.notes !== '') value.notes = draft.notes
  if (draft.totp.trim() !== '') value.totp = draft.totp.trim()
  const tags = normalizeTags(draft.tagsText)
  if (tags.length > 0) value.tags = tags
  if (draft.shared) value.shared = true
  return value
}

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i
const TOTP_RE = /^[A-Z2-7][A-Z2-7\s]*=*$/i

export function validateValue(value: KeeperItemValue): KeeperIssue[] {
  const issues: KeeperIssue[] = []
  if (value.title.trim() === '') {
    issues.push({ field: 'title', key: 'extraScreens.keeper.error.titleRequired' })
  }
  const url = (value.url ?? '').trim()
  if (url !== '' && !URL_RE.test(url)) {
    issues.push({ field: 'url', key: 'extraScreens.keeper.error.invalidUrl' })
  }
  const totp = (value.totp ?? '').trim()
  if (totp !== '' && !TOTP_RE.test(totp.replace(/\s+/g, ''))) {
    issues.push({ field: 'totp', key: 'extraScreens.keeper.error.invalidTotp' })
  }
  return issues
}

export function validateDraft(draft: KeeperDraft): KeeperIssue[] {
  return validateValue(valueFromDraft(draft))
}

/**
 * Full pre-save validation: field rules plus the vault key charset and the
 * serialized-value size cap the backend enforces.
 */
export function validateForSave(draft: KeeperDraft, existingKeys: Iterable<string> = []): KeeperIssue[] {
  const issues = validateDraft(draft)
  const key = draft.key ?? deriveItemKey(draft.title, existingKeys)
  if (!KEEPER_KEY_RE.test(key)) {
    issues.push({ field: 'key', key: 'extraScreens.keeper.error.invalidKey' })
  }
  if (serializeItemValue(valueFromDraft(draft)).length > VALUE_JSON_MAX_CHARS) {
    issues.push({ field: 'value', key: 'extraScreens.keeper.error.valueTooLarge' })
  }
  return issues
}

/** Cyrillic → Latin so a Russian title still yields a valid vault key. */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
}

/**
 * Derive a valid vault key from the item title. Letters/digits, dot, dash and
 * underscore survive (Cyrillic is transliterated); everything else becomes `-`.
 * A collision with an existing key gets a numeric suffix so `upsertItem` never
 * silently overwrites a sibling.
 */
export function deriveItemKey(title: string, existingKeys: Iterable<string> = []): string {
  const taken = new Set<string>()
  for (const key of existingKeys) taken.add(key.toLowerCase())
  const slug = title
    .toLowerCase()
    .split('')
    .map((char) => (char in TRANSLIT ? TRANSLIT[char]! : char))
    .join('')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
  const base = (slug === '' ? 'item' : slug).slice(0, 110)
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/** Normalize a vault secret path: leading slash, single slashes, no trailing slash (root stays `/`). */
export function normalizeSecretPath(path: string | null | undefined): string {
  const raw = text(path).trim()
  if (raw === '' || raw === '/') return '/'
  const collapsed = raw.replace(/\/+/g, '/')
  const withLeading = collapsed.startsWith('/') ? collapsed : `/${collapsed}`
  const trimmed = withLeading.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

function lastSegment(path: string): string {
  const parts = path.split('/').filter((part) => part !== '')
  return parts.length > 0 ? parts[parts.length - 1] : path
}

/**
 * Build the space rail from `listPaths`. The two fixed spaces are always
 * present; folders are the listed paths beneath each space root. Paths that
 * live outside both roots are folded into «Личное» rather than hidden.
 */
export function buildSpaceTree(paths: readonly string[]): KeeperSpace[] {
  const normalized = Array.from(new Set((paths ?? []).map((path) => normalizeSecretPath(path))))
  const roots = KEEPER_SPACES.map((space) => space.root)
  const orphans = normalized.filter(
    (path) => path !== '/' && !roots.some((root) => path === root || path.startsWith(`${root}/`)),
  )
  return KEEPER_SPACES.map((space) => {
    const under = normalized.filter(
      (path) => path !== space.root && path.startsWith(`${space.root}/`),
    )
    const owned = space.id === 'personal' ? [...under, ...orphans] : under
    const folders: KeeperFolder[] = Array.from(new Set(owned))
      .map((path) => ({ path, name: lastSegment(path) }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    return { id: space.id, labelKey: space.labelKey, root: space.root, folders }
  })
}

/** Substring search across key, title, username, url, notes, type and tags. */
export function filterItems(items: readonly KeeperItem[], query: string): KeeperItem[] {
  const tokens = text(query).toLowerCase().split(/\s+/).filter((token) => token !== '')
  if (tokens.length === 0) return [...items]
  return items.filter((item) => {
    const haystack = itemSearchText(item)
    return tokens.every((token) => haystack.includes(token))
  })
}

export function itemSearchText(item: KeeperItem): string {
  const value = item.value
  return [
    item.key,
    value.title,
    value.type,
    value.username ?? '',
    value.url ?? '',
    value.notes ?? '',
    value.totp ?? '',
    ...(value.tags ?? []),
  ]
    .join(' ')
    .toLowerCase()
}

/** Title-first ordering, key as the deterministic tie-break. */
export function sortItems(items: readonly KeeperItem[]): KeeperItem[] {
  return [...items].sort((a, b) => {
    const byTitle = a.value.title.localeCompare(b.value.title, 'ru')
    return byTitle !== 0 ? byTitle : a.key.localeCompare(b.key, 'ru')
  })
}