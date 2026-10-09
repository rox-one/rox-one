/**
 * BrowserTabGlyph
 *
 * Leading glyph for one browser tab, handed to the shared tab primitive as
 * `TabItem.icon`: the page favicon while idle, a spinner while loading and a
 * globe fallback. The favicon-failure fallback survives a favicon change.
 *
 * Sized by the `icon-status` token (spec D2/D6 — one tab anatomy, no literal
 * sizes), which is also why the old per-page theme tint is gone: the tab
 * surface now comes from the shared primitive, not from `instance.themeColor`.
 */

import { useEffect, useState } from 'react'
import { Globe } from 'lucide-react'
import { Spinner } from '@rox/ui'
import type { BrowserInstanceInfo } from '../../../shared/types'

export function BrowserTabGlyph({ instance }: { instance: BrowserInstanceInfo }) {
  const [faviconFailed, setFaviconFailed] = useState(false)

  useEffect(() => {
    setFaviconFailed(false)
  }, [instance.favicon])

  return (
    <span className="icon-status flex shrink-0 items-center justify-center" aria-hidden>
      {instance.isLoading ? (
        <Spinner className="text-caption" />
      ) : instance.favicon && !faviconFailed ? (
        <img
          src={instance.favicon}
          alt=""
          className="icon-status rounded-xs object-cover"
          onError={() => setFaviconFailed(true)}
        />
      ) : (
        <Globe className="icon-status" />
      )}
    </span>
  )
}