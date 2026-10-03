import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, ExternalLink, Link2, Loader2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import type { Session } from '../../../shared/types'
import { addSessionAtom, replaceLoadedSessionAtom, sessionMetaMapAtom } from '@/atoms/sessions'
import { useNavigation } from '@/contexts/NavigationContext'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { routes } from '@/lib/navigate'
import {
  JOIN_SESSION_EVENT, SESSION_LINK_EVENT, SessionLinkError, joinAndOpenSession,
  copySessionLink, parseSessionLink, type SessionLink,
} from '@/lib/session-sharing'

/** Lives outside menus so dropdown dismissal cannot discard the link or URL input. */
export function SessionSharingHost({ activeWorkspaceId, onSwitchWorkspace }: {
  activeWorkspaceId: string | null
  onSwitchWorkspace: (workspaceId: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const store = useStore()
  const addSession = useSetAtom(addSessionAtom)
  const replaceSession = useSetAtom(replaceLoadedSessionAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const [dialog, setDialog] = React.useState<'join' | 'link' | null>(null)
  const [link, setLink] = React.useState<SessionLink | null>(null)
  const [url, setUrl] = React.useState('')
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const pendingRef = React.useRef(false)
  const mountedRef = React.useRef(true)
  const workspaceRef = React.useRef(activeWorkspaceId)
  workspaceRef.current = activeWorkspaceId
  const [openTarget, setOpenTarget] = React.useState<Session | null>(null)
  const pendingOpenRef = React.useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null)

  React.useEffect(() => {
    mountedRef.current = true
    const openJoin = () => {
      if (pendingRef.current) return
      setUrl('')
      setError('')
      setDialog('join')
    }
    const openLink = (event: Event) => {
      const next = (event as CustomEvent<SessionLink>).detail
      if (!next || !parseSessionLink(next.url)) return
      setLink(next)
      setError('')
      setDialog('link')
    }
    window.addEventListener(JOIN_SESSION_EVENT, openJoin)
    window.addEventListener(SESSION_LINK_EVENT, openLink)
    return () => {
      mountedRef.current = false
      pendingOpenRef.current?.reject(new SessionLinkError('', 'invalid'))
      pendingOpenRef.current = null
      window.removeEventListener(JOIN_SESSION_EVENT, openJoin)
      window.removeEventListener(SESSION_LINK_EVENT, openLink)
    }
  }, [])

  React.useEffect(() => {
    if (!openTarget || activeWorkspaceId !== openTarget.workspaceId
      || sessionMetaMap.get(openTarget.id)?.workspaceId !== openTarget.workspaceId) return
    // Workspace restoration in NavigationProvider runs in this same commit.
    // Navigate afterward so it cannot replace the joined session with a saved tab.
    const frame = requestAnimationFrame(() => {
      void (async () => {
        try {
          await navigate(routes.view.allSessions(openTarget.id))
          pendingOpenRef.current?.resolve()
        } catch (failure) {
          pendingOpenRef.current?.reject(failure instanceof Error ? failure : new Error(String(failure)))
        } finally {
          pendingOpenRef.current = null
          if (mountedRef.current) setOpenTarget(null)
        }
      })()
    })
    return () => cancelAnimationFrame(frame)
  }, [activeWorkspaceId, openTarget, sessionMetaMap, navigate])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (pendingRef.current) return
    const destination = parseSessionLink(url)
    if (!destination) {
      setError(t('sessionSharing.error.invalid'))
      return
    }
    pendingRef.current = true
    setBusy(true)
    setError('')
    try {
      if (destination.kind === 'viewer') {
        await window.electronAPI.openUrl(destination.url)
      } else {
        await joinAndOpenSession(destination, {
          command: window.electronAPI.sessionCommand,
          readSession: id => window.electronAPI.getSessionMessages(id),
          currentWorkspace: () => workspaceRef.current,
          switchWorkspace: onSwitchWorkspace,
          openSession: session => new Promise<void>((resolve, reject) => {
            if (!mountedRef.current) { reject(new SessionLinkError('', 'invalid')); return }
            pendingOpenRef.current = { resolve, reject }
            if (store.get(sessionMetaMapAtom).has(session.id)) replaceSession(session)
            else addSession(session)
            setOpenTarget(session)
          }),
        })
        if (!mountedRef.current) return
        toast.success(t('sessionSharing.joined'))
      }
      if (mountedRef.current) setDialog(null)
    } catch (failure) {
      if (!mountedRef.current) return
      const code = failure instanceof SessionLinkError ? failure.code : undefined
      const known = ['expired', 'revoked', 'reused', 'membership_required', 'invalid'].includes(code ?? '')
      setError(known ? t(`sessionSharing.error.${code}`) : t('sessionSharing.error.failed'))
    } finally {
      pendingRef.current = false
      if (mountedRef.current) setBusy(false)
    }
  }

  const copy = async () => {
    if (!link) return
    const copied = await copySessionLink(link.url, text => navigator.clipboard.writeText(text))
    if (!mountedRef.current) return
    setLink(current => current === link ? { ...current, copied } : current)
    setError(copied ? '' : t('sessionSharing.copyManually'))
  }

  const paste = async () => {
    try {
      setUrl(await navigator.clipboard.readText())
      setError('')
    } catch {
      setError(t('sessionSharing.pasteManually'))
    }
  }

  const destination = parseSessionLink(url)
  return (
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open && !pendingRef.current) setDialog(null) }}>
      <DialogContent className="rounded-2xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {dialog === 'link' && link?.kind === 'invite' ? <UserPlus className="size-5 text-accent" /> : <Link2 className="size-5 text-accent" />}
            {dialog === 'join' ? t('sessionMenu.join') : t(link?.kind === 'invite' ? 'sessionMenu.inviteBro' : 'sessionMenu.share')}
          </DialogTitle>
          <DialogDescription>
            {dialog === 'join' ? t('sessionSharing.joinDescription') : t(link?.kind === 'invite' ? 'sessionSharing.inviteDescription' : 'sessionSharing.shareDescription')}
          </DialogDescription>
        </DialogHeader>
        {dialog === 'join' ? (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="join-session-url" className="text-sm font-medium">{t('sessionSharing.urlLabel')}</label>
              <div className="flex gap-2">
                <Input id="join-session-url" autoFocus value={url} disabled={busy} onChange={event => { setUrl(event.target.value); setError('') }}
                  placeholder={t('sessionSharing.urlPlaceholder')} aria-invalid={!!error} aria-describedby={error ? 'session-sharing-error' : undefined} />
                <Button type="button" variant="outline" onClick={() => void paste()} disabled={busy}>{t('sessionSharing.paste')}</Button>
              </div>
            </div>
            {error && <p id="session-sharing-error" role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={busy || !url.trim()}>{busy && <Loader2 className="size-4 animate-spin" />}{t(destination?.kind === 'viewer' ? 'sessionSharing.openShared' : 'sessionMenu.join')}</Button>
            </DialogFooter>
          </form>
        ) : link ? (
          <>
            <div className="flex flex-col gap-2">
              <label htmlFor="session-sharing-url" className="text-sm font-medium">{t('sessionSharing.urlLabel')}</label>
              <Input id="session-sharing-url" autoFocus readOnly value={link.url} onFocus={event => event.target.select()} />
              {link.kind === 'invite' && <p className="text-xs text-muted-foreground">{t('sessionSharing.serverScope')}</p>}
              {link.expiresAt && <p className="text-xs text-muted-foreground">{t('sessionSharing.expires', { date: new Date(link.expiresAt).toLocaleString() })}</p>}
              {!link.copied && !error && <p className="text-xs text-muted-foreground">{t('sessionSharing.copyManually')}</p>}
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              {link.kind === 'share' && <Button type="button" variant="outline" onClick={() => void window.electronAPI.openUrl(link.url).catch(() => setError(t('sessionSharing.error.failed')))}><ExternalLink />{t('common.open')}</Button>}
              <Button type="button" onClick={() => void copy()}>{link.copied ? <Check /> : <Copy />}{t(link.copied ? 'common.copied' : 'common.copy')}</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
