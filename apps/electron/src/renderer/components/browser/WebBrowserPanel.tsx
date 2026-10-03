import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, ExternalLink, LoaderCircle, RefreshCw, X } from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@/lib/utils'
import type { BrowserCookieAutoStatus } from '../../../shared/types'

type BrowserSnapshot = { url: string; title: string }

interface WebBrowserPanelProps {
  open: boolean
  onClose: () => void
  /** Inspector embed: fill the host instead of covering the window. */
  embedded?: boolean
}

// Keep the remote browser itself at a mobile viewport size, not just a mobile
// looking shell. This makes responsive sites render their mobile layout too.
const MOBILE_VIEWPORT = { width: 390, height: 720 }

/** A mobile-style viewport for the persistent VPS agent-browser session. */
export function WebBrowserPanel({ open, onClose, embedded = false }: WebBrowserPanelProps) {
  const { t } = useTranslation()
  const [instanceId, setInstanceId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<BrowserSnapshot | null>(null)
  const [image, setImage] = useState<string | null>(null)
  const [cookieStatus, setCookieStatus] = useState<BrowserCookieAutoStatus | null>(null)
  const [useImportedCookies, setUseImportedCookies] = useState(false)
  const ownedInstance = useRef<string | null>(null)
  const [address, setAddress] = useState('about:blank')
  const [busy, setBusy] = useState(false)
  const imageRef = useRef<HTMLImageElement>(null)
  const busyRef = useRef(false)

  const refresh = useCallback(async (id: string, syncAddress = false) => {
    const [shot, tree] = await Promise.all([
      window.electronAPI.browserPane.screenshotImage(id, { format: 'jpeg' }),
      window.electronAPI.browserPane.snapshot(id),
    ])
    setImage(`data:image/${shot.imageFormat};base64,${shot.base64}`)
    setSnapshot(tree)

    // The polling refresh must not write into the address field: doing that
    // used to erase a URL while the user was typing it.
    if (syncAddress) setAddress(tree.url)
  }, [])

  const run = useCallback(async (action: () => Promise<void>, syncAddress = true) => {
    const id = instanceId
    if (!id) return

    busyRef.current = true
    setBusy(true)
    try {
      await action()
      await refresh(id, syncAddress)
    } catch (error) {
      console.error('[WebBrowserPanel] browser action failed:', error)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [instanceId, refresh])

  useEffect(() => {
    void window.electronAPI.browserCookieAutoStatus().then(setCookieStatus).catch(() => setCookieStatus(null))
  }, [])
  useEffect(() => {
    if (!open) return
    const refreshConsent = () => {
      void window.electronAPI.browserCookieAutoStatus()
        .then((status) => {
          setCookieStatus(status)
          if (!status.consent) setUseImportedCookies(false)
        })
        .catch(() => setCookieStatus(null))
    }
    refreshConsent()
    const timer = window.setInterval(refreshConsent, 10_000)
    return () => window.clearInterval(timer)
  }, [open])
  const canUseImportedCookies = cookieStatus?.consent === true

  useEffect(() => {
    if (!open) return
    let cancelled = false

    void (async () => {
      try {
        if (ownedInstance.current) {
          await window.electronAPI.browserPane.destroy(ownedInstance.current)
          ownedInstance.current = null
        }
        const id = await window.electronAPI.browserPane.create({
          show: true,
          useImportedCookies: useImportedCookies && canUseImportedCookies,
        })
        ownedInstance.current = id
        if (cancelled) return

        setInstanceId(id)
        await window.electronAPI.browserPane.resize(id, MOBILE_VIEWPORT.width, MOBILE_VIEWPORT.height)
        await new Promise((resolve) => window.setTimeout(resolve, 250))
        if (!cancelled) await refresh(id, true)
      } catch (error) {
        console.error('[WebBrowserPanel] failed to open VPS browser:', error)
      }
    })()

    return () => { cancelled = true }
  }, [open, refresh, useImportedCookies, canUseImportedCookies])

  useEffect(() => {
    if (!open || !instanceId) return
    const timer = window.setInterval(() => {
      if (!busyRef.current) void refresh(instanceId).catch(() => undefined)
    }, 1500)
    return () => window.clearInterval(timer)
  }, [open, instanceId, refresh])

  const navigate = () => {
    const url = address.trim()
    if (!instanceId || !url) return
    void run(async () => {
      await window.electronAPI.browserPane.navigate(instanceId, url)
    })
  }

  const clickViewport = (event: React.MouseEvent<HTMLImageElement>) => {
    if (!instanceId || !imageRef.current) return
    const rect = imageRef.current.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const scaleX = imageRef.current.naturalWidth / rect.width
    const scaleY = imageRef.current.naturalHeight / rect.height
    void run(async () => {
      await window.electronAPI.browserPane.clickAt(
        instanceId,
        (event.clientX - rect.left) * scaleX,
        (event.clientY - rect.top) * scaleY,
      )
    }, false)
  }

  if (!open) return null

  return (
    <section className={embedded
      ? 'flex h-full min-h-0 w-full flex-col bg-background'
      : 'fixed inset-x-0 bottom-0 top-[var(--topbar-height)] z-40 flex flex-col bg-[#f4f5f7] shadow-strong'
    }>
      <header className="flex h-[42px] min-h-0 shrink-0 items-center gap-1 border-b border-border/40 bg-background px-2 sm:px-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 rounded-full"
          disabled={busy || !instanceId}
          onClick={() => void run(async () => { await window.electronAPI.browserPane.goBack(instanceId!) })}
          title={t('browser.back')}
          aria-label={t('browser.back')}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 rounded-full"
          disabled={busy || !instanceId}
          onClick={() => void run(async () => { await window.electronAPI.browserPane.goForward(instanceId!) })}
          title={t('browser.forward')}
          aria-label={t('browser.forward')}
        >
          <ArrowRight className="size-4" />
        </Button>
        <label className="flex max-w-[180px] shrink-0 items-center gap-1 text-[11px] text-muted-foreground" title={canUseImportedCookies ? cookieStatus?.domains?.join(', ') : t('settings.browserImport.auto.noImportedConsent')}>
          <input
            type="checkbox"
            checked={useImportedCookies}
            disabled={!cookieStatus?.consent || busy}
            onChange={(event) => setUseImportedCookies(event.target.checked)}
          />
          <span className="truncate">{t('settings.browserImport.auto.useImportedCookies')}</span>
        </label>
        {cookieStatus?.consent && (cookieStatus.profileName || cookieStatus.domains?.length) ? (
          <span className="max-w-[96px] truncate text-[9px] text-muted-foreground" title={cookieStatus.domains?.join(', ')}>
            {cookieStatus.profileName ?? ''}{cookieStatus.domains?.length ? ` · ${cookieStatus.domains.join(', ')}` : ''}
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 rounded-full"
          disabled={busy || !instanceId}
          onClick={() => void run(async () => { await window.electronAPI.browserPane.reload(instanceId!) })}
          title={t('browser.refresh')}
          aria-label={t('browser.refresh')}
        >
          <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
        </Button>

        <form className="min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); navigate() }}>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            className="h-9 w-full rounded-xl border border-black/[0.12] bg-black/[0.04] px-3 text-[14px] outline-none transition focus:border-black/25 focus:bg-background"
            placeholder={t('browser.urlPlaceholder')}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label={t('common.url')}
          />
        </form>

        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 rounded-full"
          disabled={!snapshot?.url && !address}
          onClick={() => window.open(snapshot?.url ?? address, '_blank', 'noopener,noreferrer')}
          title={t('browser.openInNewTab')}
          aria-label={t('browser.openInNewTab')}
        >
          <ExternalLink className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" className="size-7 shrink-0 rounded-full" onClick={onClose} title={t('browser.close')} aria-label={t('browser.close')}>
          <X className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-5 sm:py-5">
        <div className="mx-auto flex min-h-full w-full max-w-[430px] items-start justify-center overflow-hidden rounded-[26px] border border-black/[0.12] bg-black shadow-strong">
          <div className="relative w-full overflow-hidden bg-black">
            {image ? (
              <img
                ref={imageRef}
                src={image}
                alt={snapshot?.title || t('browser.page')}
                className={cn('block h-auto w-full cursor-crosshair', busy && 'opacity-70')}
                onClick={clickViewport}
              />
            ) : (
              <div className="flex aspect-[390/720] items-center justify-center text-white/60">
                <LoaderCircle className="size-6 animate-spin" />
              </div>
            )}
            {busy && image && <div className="pointer-events-none absolute inset-0 bg-white/10" />}
          </div>
        </div>
      </div>
    </section>
  )
}
