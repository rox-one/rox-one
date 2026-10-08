/**
 * W1-07 (#1504) — «+» global create menu on the right action rail (UI-SPEC
 * §3.2). Renders `fallback` (the baseline «+» = new session button) unless a
 * flag-gated entry is visible, so with every flag OFF nothing changes.
 */
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import * as Icons from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuSub,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
  StyledDropdownMenuSubContent,
  StyledDropdownMenuSubTrigger,
} from '@rox/ui'
import { useSlotContributions } from './useSlots'
import { useAtomValue } from 'jotai'
import { enabledShellFlagsAtom } from './unified-flags'
import {
  buildGlobalCreateMenu,
  GLOBAL_CREATE_SLOT,
  runGlobalCreateIntent,
  type GlobalCreateMenuEntry,
  type GlobalCreateRunDeps,
} from './global-create'

function iconFor(name: string | undefined): LucideIcon | null {
  if (!name) return null
  const icon = (Icons as unknown as Record<string, LucideIcon | undefined>)[name]
  return icon ?? null
}

function EntryLabel({ entry, label }: { entry: GlobalCreateMenuEntry; label: string }) {
  const Icon = iconFor(entry.icon)
  return (
    <>
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {label}
    </>
  )
}

export interface GlobalCreateMenuProps extends GlobalCreateRunDeps {
  /** Baseline control rendered while no flagged entry is visible. */
  fallback: ReactNode
  /** Trigger content (icon) for the menu. */
  trigger: (props: { label: string }) => ReactNode
  label: string
}

export function GlobalCreateMenu({ fallback, trigger, label, navigate, host }: GlobalCreateMenuProps) {
  const { t } = useTranslation()
  const flags = useAtomValue(enabledShellFlagsAtom)
  // Subscribes to registry changes; the model itself is built below.
  const contributions = useSlotContributions(GLOBAL_CREATE_SLOT)
  const model = useMemo(() => buildGlobalCreateMenu({ flags }), [flags, contributions])

  if (!model.hasFlaggedItems) return <>{fallback}</>

  const run = (entry: GlobalCreateMenuEntry) => {
    if (entry.intent) runGlobalCreateIntent(entry.intent, { navigate, host })
  }

  const renderEntry = (entry: GlobalCreateMenuEntry) => {
    if (entry.children.length > 0) {
      return (
        <DropdownMenuSub key={entry.id}>
          <StyledDropdownMenuSubTrigger data-global-create={entry.id}>
            <EntryLabel entry={entry} label={t(entry.titleKey)} />
          </StyledDropdownMenuSubTrigger>
          <StyledDropdownMenuSubContent>
            {entry.children.map((child) => (
              <StyledDropdownMenuItem key={child.id} data-global-create={child.id} onClick={() => run(child)}>
                <EntryLabel entry={child} label={t(child.titleKey)} />
              </StyledDropdownMenuItem>
            ))}
          </StyledDropdownMenuSubContent>
        </DropdownMenuSub>
      )
    }
    return (
      <StyledDropdownMenuItem key={entry.id} data-global-create={entry.id} onClick={() => run(entry)}>
        <EntryLabel entry={entry} label={t(entry.titleKey)} />
      </StyledDropdownMenuItem>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger({ label })}</DropdownMenuTrigger>
      <StyledDropdownMenuContent side="left" align="start" data-global-create-menu>
        {model.create.map(renderEntry)}
        {model.create.length > 0 && model.tools.length > 0 && <StyledDropdownMenuSeparator />}
        {model.tools.map(renderEntry)}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
