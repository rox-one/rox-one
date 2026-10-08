/**
 * W1-04 (#1501) — Offline contact-card store.
 *
 * One JSON file per workspace at `<workspaceRoot>/.rox/contacts/cards.json`
 * (private directories 0700, file 0600, atomic replace). It holds the user's
 * own contact cards (MIG-06 Dossier import, offline edits); members of the
 * workspace still come only from the directory read model.
 */

import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from '@rox/shared/utils/files'
import type { ContactCard } from './types.ts'

export const CONTACT_STORE_VERSION = 1

interface ContactStoreFile {
  version: typeof CONTACT_STORE_VERSION
  cards: ContactCard[]
}

function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Private contact storage is unavailable')
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error('Private contact storage is unavailable')
  }
  chmodSync(path, 0o700)
}

export class ContactCardStoreError extends Error {
  constructor(readonly code: 'CORRUPT' | 'UNSUPPORTED_VERSION') {
    super(code)
    this.name = 'ContactCardStoreError'
  }
}

export class ContactCardStore {
  readonly filePath: string
  private readonly dir: string
  private readonly roxDir: string

  constructor(workspaceRoot: string) {
    this.roxDir = join(workspaceRoot, '.rox')
    this.dir = join(this.roxDir, 'contacts')
    this.filePath = join(this.dir, 'cards.json')
  }

  /** Read all cards. A missing file is an empty store; a corrupt file throws (never overwritten silently). */
  list(): ContactCard[] {
    if (!existsSync(this.filePath)) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf-8'))
    } catch {
      throw new ContactCardStoreError('CORRUPT')
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as ContactStoreFile).cards)) {
      throw new ContactCardStoreError('CORRUPT')
    }
    if ((parsed as ContactStoreFile).version !== CONTACT_STORE_VERSION) throw new ContactCardStoreError('UNSUPPORTED_VERSION')
    return (parsed as ContactStoreFile).cards
  }

  get(contactCardId: string): ContactCard | null {
    return this.list().find(card => card.contactCardId === contactCardId) ?? null
  }

  /** Replace the full card set atomically. */
  writeAll(cards: readonly ContactCard[]): void {
    privateDirectory(this.roxDir)
    privateDirectory(this.dir)
    const body: ContactStoreFile = { version: CONTACT_STORE_VERSION, cards: [...cards] }
    atomicWriteFileSync(this.filePath, `${JSON.stringify(body, null, 2)}\n`, { durable: true })
    chmodSync(this.filePath, 0o600)
  }
}
