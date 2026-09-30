/**
 * Rox Mail (inbox.mail.v1) — IPC contract between the renderer and the main
 * process mail bridge (main/mail). Direct ipcMain like meetings-local: the
 * mailbox credential lives in the main process (CredentialManager →
 * Keychain) and never reaches the renderer.
 */

export const MAIL_FLAG = 'inbox.mail.v1'
export const MAIL_DEFAULT_SERVER_URL = 'http://127.0.0.1:8480'
export const MAIL_DEFAULT_DOMAIN = 'rox.one'

export const MAIL_IPC = {
  STATUS: 'mail:status',
  ENSURE: 'mail:ensure',
  SET_SERVER: 'mail:set-server',
  FOLDERS: 'mail:folders',
  LIST: 'mail:list',
  GET: 'mail:get',
  GET_THREAD: 'mail:get-thread',
  SET_FLAGS: 'mail:set-flags',
  MOVE: 'mail:move',
  REMOVE: 'mail:remove',
  SEND: 'mail:send',
  SAVE_DRAFT: 'mail:save-draft',
  PICK_FILES: 'mail:pick-files',
  SAVE_ATTACHMENT: 'mail:save-attachment',
  REVEAL: 'mail:reveal',
  CHANGED: 'mail:changed',
} as const

export type MailState = 'disabled' | 'unreachable' | 'no-mailbox' | 'provisioning' | 'ready' | 'error'

export interface MailStatus {
  flag: typeof MAIL_FLAG
  enabled: boolean
  state: MailState
  serverUrl: string
  domain: string
  /** Loopback server on this device — external mail cannot reach it (no MX/DNS). */
  local: boolean
  reachable: boolean
  address: string | null
  push: 'open' | 'retry' | 'off'
  error?: string
}

export type MailFolderRole = 'inbox' | 'sent' | 'drafts' | 'archive' | 'junk' | 'trash'

export interface MailFolder {
  id: string
  name: string
  role: MailFolderRole | null
  total: number
  unread: number
}

export interface MailAddress { name: string | null; email: string }

export interface MailSummary {
  id: string
  threadId: string
  folderIds: string[]
  from: MailAddress[]
  to: MailAddress[]
  subject: string
  preview: string
  receivedAt: number
  seen: boolean
  flagged: boolean
  draft: boolean
  hasAttachment: boolean
  size: number
}

export interface MailAttachment {
  blobId: string
  name: string
  type: string
  size: number
  inline: boolean
}

export interface MailMessage extends MailSummary {
  cc: MailAddress[]
  bcc: MailAddress[]
  replyTo: MailAddress[]
  sentAt: number | null
  messageId: string[]
  inReplyTo: string[]
  references: string[]
  text: string
  /** Raw HTML from the server — the renderer sanitizes and sandboxes it. */
  html: string | null
  attachments: MailAttachment[]
}

export interface MailListQuery {
  folderId?: string
  role?: MailFolderRole
  text?: string
  limit?: number
  /** Only unseen messages (used by «Все» in Входящие). */
  unseenOnly?: boolean
}

export interface MailPickedFile { path: string; name: string; size: number; type: string }

export interface MailComposeInput {
  to: string
  cc?: string
  bcc?: string
  subject: string
  text: string
  /** Reply / reply-all / forward source message. */
  sourceId?: string
  mode?: 'new' | 'reply' | 'replyAll' | 'forward'
  /** Local files to attach (from pickFiles / drag & drop paths). */
  files?: MailPickedFile[]
  /** Forward: re-attach these attachments of the source message. */
  forwardAttachments?: MailAttachment[]
  /** Previous autosaved draft to replace. */
  draftId?: string
}

export type MailResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string }

export interface MailLocalApi {
  status(): Promise<MailStatus>
  ensureMailbox(): Promise<MailResult<MailStatus>>
  setServer(url: string): Promise<MailResult<MailStatus>>
  folders(): Promise<MailResult<MailFolder[]>>
  list(query: MailListQuery): Promise<MailResult<{ total: number; items: MailSummary[] }>>
  get(id: string): Promise<MailResult<MailMessage | null>>
  getThread(threadId: string): Promise<MailResult<MailMessage[]>>
  setFlags(ids: string[], flags: { seen?: boolean; flagged?: boolean }): Promise<MailResult<number>>
  move(ids: string[], target: MailFolderRole | string): Promise<MailResult<number>>
  remove(ids: string[]): Promise<MailResult<number>>
  send(input: MailComposeInput): Promise<MailResult<{ emailId: string }>>
  saveDraft(input: MailComposeInput): Promise<MailResult<{ draftId: string }>>
  pickFiles(): Promise<MailPickedFile[]>
  saveAttachment(emailId: string, attachment: MailAttachment): Promise<MailResult<{ path: string }>>
  reveal(path: string): Promise<boolean>
  onChanged(cb: (event: { at: number; status?: MailStatus }) => void): () => void
}
