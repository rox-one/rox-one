/**
 * Screenshot artifact: renders a real inline image carried by a tool result or
 * tool input as a `data:` URI. No placeholder footage is ever fabricated — the
 * component is only mounted when a data-URI image actually exists.
 */
import * as React from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ArtifactShell } from './ArtifactShell'

export interface ScreenshotArtifactProps {
  /** `data:image/...` URI captured from the turn. */
  src: string
  /** Optional caption / source label, e.g. a file path. */
  caption?: string
}

export function ScreenshotArtifact({ src, caption }: ScreenshotArtifactProps) {
  const { t } = useTranslation()
  const headingId = React.useId()

  return (
    <ArtifactShell
      labelledBy={headingId}
      icon={<ImageIcon className="icon-toolbar" />}
      title={t('chat.continuum.screenshot.title', { defaultValue: 'Снимок экрана' })}
      subtitle={caption}
    >
      <img
        src={src}
        alt={t('chat.continuum.screenshot.alt', { defaultValue: 'Снимок экрана из инструмента' })}
        className="max-h-[420px] w-full bg-surface-input object-contain p-1"
        loading="lazy"
      />
    </ArtifactShell>
  )
}