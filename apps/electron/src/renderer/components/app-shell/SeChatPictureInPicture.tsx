import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { motion, AnimatePresence } from 'motion/react'
import { MessageSquare, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { seChatPipOpenAtom } from '@/atoms/se-chat-pip'
import { focusedSessionIdAtom } from '@/atoms/panel-stack'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { SE_SPRING_PANEL } from '@/lib/motion/super-engineering-springs'
import { cn } from '@/lib/utils'

export function SeChatPictureInPicture() {
  const { t } = useTranslation()
  const [open, setOpen] = useAtom(seChatPipOpenAtom)
  const sessionId = useAtomValue(focusedSessionIdAtom)
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const title =
    (sessionId && metaMap.get(sessionId)?.name) ||
    (sessionId && metaMap.get(sessionId)?.preview) ||
    t('se.chat.pip.noSession')

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-label={t('se.chat.pip.title')}
          data-testid="se-chat-pip"
          initial={{ opacity: 0, scale: 0.92, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 12 }}
          transition={SE_SPRING_PANEL}
          className={cn(
            'pointer-events-auto fixed bottom-6 right-6 z-[9999] w-[min(360px,calc(100vw-2rem))]',
            'rounded-xl border border-white/10 bg-[color-mix(in_oklch,var(--paper)_94%,transparent)] shadow-2xl backdrop-blur-xl',
          )}
        >
          <header className="flex items-center gap-2 border-b border-white/8 px-3 py-2">
            <MessageSquare className="size-4 shrink-0 text-foreground/70" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</span>
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground hover:bg-white/6 hover:text-foreground"
              aria-label={t('common.close')}
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </button>
          </header>
          <p className="px-3 py-2 text-xs text-muted-foreground">{t('se.chat.pip.hint')}</p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
