/**
 * Renderer flag for the Inbox notification surface (`notify.inbox.v1`).
 *
 * Mirrors the `atoms/entities-links.ts` pattern (atomWithStorage + KEYS, plain
 * jotai): the Inbox aggregator reads it directly, so the hook stays loadable in
 * the browser test fixture (the shell's flag set lives behind `unified-flags`,
 * which pulls in `node:fs`). `unified-flags.ts` lists this atom in
 * `DEDICATED_FLAG_ATOMS`, so the shell reports the same value and cannot
 * shadow it with the generic per-id store.
 *
 * Default OFF: with the flag off the Inbox builds exactly the rows it built
 * before W1-09 (#1506).
 */
import { atomWithStorage } from 'jotai/utils'
import { WORKBENCH_FLAG } from '@rox/core/platform/workbench'
import { KEYS, getKeyString } from '@/lib/local-storage'

export const NOTIFY_INBOX_FLAG_ID = WORKBENCH_FLAG.notifyInboxV1

const opts = { getOnInit: true } as const

export const featureNotifyInboxV1Atom = atomWithStorage<boolean>(
  getKeyString(KEYS.featureNotifyInboxV1),
  false,
  undefined,
  opts,
)