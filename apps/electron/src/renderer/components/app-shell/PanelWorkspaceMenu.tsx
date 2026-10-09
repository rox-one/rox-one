import { Check, Columns2, Focus, Grid2X2, LayoutGrid, Maximize2, Minimize2, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { usePanelWorkspaceLayout, type PanelWorkspaceLayoutMode } from '@/hooks/usePanelWorkspaceLayout'
import { useActionRegistry } from '@/actions'
import { panelStackAtom, expandedPanelIdAtom } from '@/atoms/panel-stack'
import { reconcilePanelFullScreen } from '@/lib/panel-workspace-layout'
import { TopBarButton } from '@/components/ui/TopBarButton'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'

const MODES = [
  { mode: 'auto', key: 'auto', icon: LayoutGrid },
  { mode: 'columns', key: 'columns', icon: Columns2 },
  { mode: 'grid-2', key: 'grid2', icon: Grid2X2 },
  { mode: 'grid-3', key: 'grid3', icon: LayoutGrid },
  { mode: 'focus', key: 'focus', icon: Focus },
] as const satisfies ReadonlyArray<{ mode: PanelWorkspaceLayoutMode; key: string; icon: typeof LayoutGrid }>

/** One stable entry point for geometry; switching it never replaces panel routes. */
export function PanelWorkspaceMenu() {
  const { t } = useTranslation()
  const { mode, setMode, resetLayout } = usePanelWorkspaceLayout()
  const { execute } = useActionRegistry()
  const panelIds = useAtomValue(panelStackAtom).map((panel) => panel.id)
  const expanded = reconcilePanelFullScreen(useAtomValue(expandedPanelIdAtom), panelIds) !== null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TopBarButton aria-label={t('panelWorkspace.layout')} title={t('panelWorkspace.layout')}>
          <LayoutGrid className="size-4" aria-hidden />
        </TopBarButton>
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="end" minWidth="min-w-52">
        {MODES.map(({ mode: value, key, icon: Icon }) => (
          <StyledDropdownMenuItem key={value} onClick={() => setMode(value)}>
            <Icon className="size-4" aria-hidden />
            <span className="flex-1">{t(`panelWorkspace.${key}`)}</span>
            {mode === value && <Check className="size-3.5" aria-label={t('panelWorkspace.selected')} />}
          </StyledDropdownMenuItem>
        ))}
        <StyledDropdownMenuSeparator />
        <StyledDropdownMenuItem disabled={panelIds.length === 0} onClick={() => execute('panel.toggleFullScreen')}>
          {expanded ? <Minimize2 className="icon-caption" aria-hidden /> : <Maximize2 className="icon-caption" aria-hidden />}
          <span>{t(expanded ? 'panelWorkspace.restore' : 'panelWorkspace.expand')}</span>
        </StyledDropdownMenuItem>
        <StyledDropdownMenuSeparator />
        <StyledDropdownMenuItem onClick={resetLayout}>
          <RotateCcw className="size-4" aria-hidden />
          <span>{t('panelWorkspace.reset')}</span>
        </StyledDropdownMenuItem>
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
