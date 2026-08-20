import * as React from 'react'
import { KnowledgeNavigator } from '@/knowledge/KnowledgeNavigator'
import { MobileWebUIFrame, type MobileDevice } from './MobileWebUIFrame'
import { MobilePlaygroundProviders } from './MobilePlaygroundProviders'

interface KnowledgeMobilePreviewProps {
  device?: MobileDevice
  showBezel?: boolean
}

/**
 * Production KnowledgeNavigator inside a 390px (iPhone 15) phone frame.
 * `layout="mobile"` skips window-width detection so the playground host
 * size cannot force desktop chrome.
 */
export function KnowledgeMobilePreview({
  device = 'iphone-15',
  showBezel = true,
}: KnowledgeMobilePreviewProps) {
  return (
    <MobilePlaygroundProviders>
      <MobileWebUIFrame device={device} showBezel={showBezel}>
        <div className="flex h-full w-full flex-col bg-background">
          <KnowledgeNavigator layout="mobile" />
        </div>
      </MobileWebUIFrame>
    </MobilePlaygroundProviders>
  )
}
