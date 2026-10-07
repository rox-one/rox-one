import { useCallback, type ReactNode } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  Calendar,
  ChevronsRight,
  Globe,
  Pin,
  Plus,
  SquareTerminal,
  SquareCheck,
  StickyNote,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import {
  focusedPanelIndexAtom,
  pushPanelAtom,
} from '@/atoms/panel-stack'
import { inspectorEdgeRevealModeAtom } from '@/atoms/panel-auto-hide'
import { bottomTerminalOpenAtom, inspectorUserOpenedAtom, inspectorVisibleAtom } from '@/atoms/unified-shell'
import {
  ROX_MEETINGS_COMPOSE_EVENT,
  ROX_NOTES_COMPOSE_EVENT,
  ROX_TASKS_COMPOSE_EVENT,
} from './inspector-compose-events'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes, type ViewRoute } from '../../shared/routes'
import { cn } from '@/lib/utils'
import { CHROME_DENSITY } from './chrome-density'

const INSPECTOR_RAIL_WIDTH = CHROME_DENSITY.railWidth

type InspectorActionRailProps = {
  browserPanelActive: boolean
  terminalActive: boolean
  onCollapse: () => void
  onBrowserOpen: () => void
}

function ActionButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active ?? false}
          onClick={onClick}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] transition-colors',
            active
              ? 'bg-accent/10 text-accent'
              : 'text-foreground/45 hover:bg-foreground/5 hover:text-foreground',
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  )
}

export function InspectorActionRail({
  browserPanelActive,
  terminalActive,
  onCollapse,
  onBrowserOpen,
}: InspectorActionRailProps) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const pushPanel = useSetAtom(pushPanelAtom)
  const panelIndex = useAtomValue(focusedPanelIndexAtom)
  const setBottomTerminalOpen = useSetAtom(bottomTerminalOpenAtom)
  const setEdgeMode = useSetAtom(inspectorEdgeRevealModeAtom)
  const setInspectorVisible = useSetAtom(inspectorVisibleAtom)
  const setInspectorUserOpened = useSetAtom(inspectorUserOpenedAtom)
  const edgeMode = useAtomValue(inspectorEdgeRevealModeAtom)

  const openAdjacent = useCallback(
    (route: ViewRoute) => {
      const afterIndex = panelIndex >= 0 ? panelIndex : undefined
      pushPanel({ route, afterIndex })
    },
    [panelIndex, pushPanel],
  )

  const onNewSession = useCallback(() => {
    void navigate(routes.action.newSession())
  }, [navigate])

  const onNewTask = useCallback(() => {
    openAdjacent(routes.view.tasks())
    window.dispatchEvent(new CustomEvent(ROX_TASKS_COMPOSE_EVENT, { detail: { mode: 'create' } }))
  }, [openAdjacent])

  const onNewEvent = useCallback(() => {
    openAdjacent(routes.view.meetings())
    window.dispatchEvent(new CustomEvent(ROX_MEETINGS_COMPOSE_EVENT, { detail: { mode: 'create' } }))
  }, [openAdjacent])

  const onNewNote = useCallback(() => {
    openAdjacent(routes.view.notes())
    window.dispatchEvent(new CustomEvent(ROX_NOTES_COMPOSE_EVENT, { detail: { mode: 'create' } }))
  }, [openAdjacent])

  const onBrowser = useCallback(() => {
    const api = window.electronAPI
    if (api?.browserPane?.createEmbedded) {
      void api.browserPane
        .createEmbedded({ useImportedCookies: true })
        .then((id) => {
          openAdjacent(routes.view.browser(id))
        })
        .catch(() => onBrowserOpen())
      return
    }
    onBrowserOpen()
  }, [onBrowserOpen, openAdjacent])

  const onTerminal = useCallback(() => {
    setBottomTerminalOpen(true)
  }, [setBottomTerminalOpen])

  const onPin = useCallback(() => {
    setEdgeMode('pinned')
    setInspectorVisible(true)
    setInspectorUserOpened(true)
  }, [setEdgeMode, setInspectorUserOpened, setInspectorVisible])

  return (
    <div
      className="chrome-rail rox-shell-pane flex h-full shrink-0 flex-col items-center gap-0.5 py-1.5 rox-shell-divider-l"
      style={{ width: INSPECTOR_RAIL_WIDTH }}
      data-inspector-action-rail
    >
      <ActionButton label={t('inspector.action.newSession')} onClick={onNewSession}>
        <Plus className="h-4 w-4" />
      </ActionButton>
      <ActionButton label={t('inspector.action.newTask')} onClick={onNewTask}>
        <SquareCheck className="h-4 w-4" />
      </ActionButton>
      <ActionButton label={t('inspector.action.newEvent')} onClick={onNewEvent}>
        <Calendar className="h-4 w-4" />
      </ActionButton>
      <ActionButton label={t('inspector.action.newNote')} onClick={onNewNote}>
        <StickyNote className="h-4 w-4" />
      </ActionButton>
      <ActionButton label={t('inspector.action.browser')} active={browserPanelActive} onClick={onBrowser}>
        <Globe className="h-4 w-4" />
      </ActionButton>
      <div className="mt-auto flex flex-col items-center gap-0.5">
        <ActionButton
          label={t('inspector.pin')}
          active={edgeMode === 'pinned'}
          onClick={onPin}
        >
          <Pin className="h-4 w-4" />
        </ActionButton>
        <ActionButton label={t('inspector.action.terminal')} active={terminalActive} onClick={onTerminal}>
          <SquareTerminal className="h-4 w-4" />
        </ActionButton>
        <ActionButton label={t('inspector.hide')} onClick={onCollapse}>
          <ChevronsRight className="h-4 w-4" />
        </ActionButton>
      </div>
    </div>
  )
}
