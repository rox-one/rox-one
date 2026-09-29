/**
 * Electron wiring for Rox Mail (direct ipcMain, like meetings-local): the
 * mailbox credential and the JMAP connection stay in the main process.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { CONFIG_DIR } from '@craft-agent/shared/config'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import type { MailboxSecretStore } from '@craft-agent/shared/mail'
import { MAIL_IPC as C, type MailAttachment, type MailComposeInput, type MailListQuery, type MailPickedFile, type MailStatus } from '../../shared/mail-local'
import { MailService, errorResult } from './mail-service'
import { safeFileName } from './mail-model'

let service: MailService | null = null
const savedPaths = new Set<string>()

function broadcast(status?: MailStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(C.CHANGED, { at: Date.now(), status })
  }
}

/** CredentialManager-backed store: encrypted credentials file, master key in the OS keychain. */
export function credentialManagerSecrets(): MailboxSecretStore {
  const id = (address: string) => ({ type: 'service_oauth' as const, workspaceId: 'global', name: `rox-mail.${address.toLowerCase().replace(/[^a-z0-9.@_-]/g, '-')}` })
  return {
    async get(address) {
      const cred = await getCredentialManager().get(id(address))
      return cred?.value || null
    },
    async put(address, secret) {
      await getCredentialManager().set(id(address), { value: secret, tokenType: 'Basic', source: 'native' })
    },
    async delete(address) {
      await getCredentialManager().delete(id(address))
    },
  }
}

async function identityHints(): Promise<{ ownerUuid?: string | null; handles: Array<string | null | undefined> }> {
  const handles: Array<string | null | undefined> = []
  let ownerUuid: string | null = null
  try {
    const cloud = await getCredentialManager().getRoxCloudSession()
    if (cloud?.userId) ownerUuid = cloud.userId
    if (cloud?.email) handles.push(cloud.email)
    if (cloud?.name) handles.push(cloud.name)
  } catch { /* not connected to rox.one */ }
  try {
    const { getIdentityStore } = await import('@craft-agent/core/platform/identity/store')
    const profile = getIdentityStore(CONFIG_DIR).getState().profile as { displayName?: string; email?: string }
    if (profile?.email) handles.splice(ownerUuid ? 1 : 0, 0, profile.email)
    if (profile?.displayName) handles.push(profile.displayName)
  } catch { /* profile optional */ }
  return { ownerUuid, handles }
}

async function senderName(): Promise<string | null> {
  try {
    const cloud = await getCredentialManager().getRoxCloudSession()
    if (cloud?.name) return cloud.name
  } catch { /* not connected */ }
  try {
    const { getIdentityStore } = await import('@craft-agent/core/platform/identity/store')
    const profile = getIdentityStore(CONFIG_DIR).getState().profile as { displayName?: string }
    return profile?.displayName || null
  } catch {
    return null
  }
}

function uniquePath(dir: string, name: string): string {
  const safe = safeFileName(name)
  const ext = extname(safe)
  const stem = basename(safe, ext)
  let candidate = join(dir, safe)
  for (let i = 2; existsSync(candidate) && i < 1000; i++) candidate = join(dir, `${stem} (${i})${ext}`)
  return candidate
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json',
  '.zip': 'application/zip', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ics': 'text/calendar', '.html': 'text/html',
}

export function registerMailIpc(log?: (message: string, error?: unknown) => void): MailService {
  if (service) return service
  const s = new MailService({
    configDir: CONFIG_DIR,
    secrets: credentialManagerSecrets(),
    identity: identityHints,
    senderName,
    emit: broadcast,
    log,
    deviceLabel: `rox-desktop:${process.platform}:${app.getName()}`,
  })
  service = s

  const handle = (channel: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, fn)
  }
  const wrap = <T>(fn: () => Promise<T>) => fn().then((value) => ({ ok: true as const, value }), errorResult)

  handle(C.STATUS, () => s.status())
  handle(C.ENSURE, () => wrap(() => s.ensureMailbox()))
  handle(C.SET_SERVER, (_e, url: string) => wrap(async () => { s.setServerUrl(String(url ?? '')); const st = await s.status(); broadcast(st); return st }))
  handle(C.FOLDERS, () => wrap(() => s.folders()))
  handle(C.LIST, (_e, query: MailListQuery) => wrap(() => s.list(query ?? {})))
  handle(C.GET, (_e, id: string) => wrap(() => s.get(String(id))))
  handle(C.SET_FLAGS, (_e, ids: string[], flags: { seen?: boolean; flagged?: boolean }) => wrap(() => s.setFlags(Array.isArray(ids) ? ids.map(String) : [], flags ?? {})))
  handle(C.MOVE, (_e, ids: string[], target: string) => wrap(() => s.move(Array.isArray(ids) ? ids.map(String) : [], String(target))))
  handle(C.REMOVE, (_e, ids: string[]) => wrap(() => s.remove(Array.isArray(ids) ? ids.map(String) : [])))
  handle(C.SEND, (_e, input: MailComposeInput) => wrap(() => s.send(input)))
  handle(C.SAVE_DRAFT, (_e, input: MailComposeInput) => wrap(() => s.saveDraft(input)))
  handle(C.PICK_FILES, async (event): Promise<MailPickedFile[]> => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] })
      : await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
    if (res.canceled) return []
    const { statSync } = await import('node:fs')
    return res.filePaths.map((p) => ({ path: p, name: basename(p), size: statSync(p).size, type: MIME[extname(p).toLowerCase()] ?? 'application/octet-stream' }))
  })
  handle(C.SAVE_ATTACHMENT, (_e, _emailId: string, attachment: MailAttachment) => wrap(async () => {
    const bytes = await s.download(attachment)
    const target = uniquePath(app.getPath('downloads'), attachment.name)
    await writeFile(target, bytes)
    savedPaths.add(target)
    return { path: target }
  }))
  // Reveal only files this bridge saved (no arbitrary path probing from the renderer).
  handle(C.REVEAL, (_e, path: string) => {
    if (!savedPaths.has(path)) return false
    shell.showItemInFolder(path)
    return true
  })

  app.on('before-quit', () => s.dispose())
  return s
}
