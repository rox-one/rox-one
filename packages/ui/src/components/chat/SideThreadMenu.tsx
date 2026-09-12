import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Swords } from 'lucide-react'
import { SIDE_THREAD_ACTIONS, type SideThreadAction } from '@craft-agent/shared/side-threads'
import { SimpleDropdown, SimpleDropdownItem } from '../ui/SimpleDropdown'
import { cn } from '../../lib/utils'

export type SideThreadMenuProps = {
  onSelect: (action: SideThreadAction) => void
  className?: string
}

export function SideThreadMenu({ onSelect, className }: SideThreadMenuProps) {
  const { t } = useTranslation()

  return (
    <SimpleDropdown
      align="end"
      trigger={
        <button
          type="button"
          aria-label={t('sideThread.menu')}
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
            className,
          )}
        >
          <Swords className="h-3.5 w-3.5" />
        </button>
      }
    >
      {SIDE_THREAD_ACTIONS.map((action) => (
        <SimpleDropdownItem key={action} onClick={() => onSelect(action)}>
          {t(`sideThread.action.${action}`)}
        </SimpleDropdownItem>
      ))}
    </SimpleDropdown>
  )
}
