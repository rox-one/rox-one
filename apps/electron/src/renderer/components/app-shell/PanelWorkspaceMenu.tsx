import { Check, Columns2, Focus, Grid2X2, LayoutGrid, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePanelWorkspaceLayout, type PanelWorkspaceLayoutMode } from '@/hooks/usePanelWorkspaceLayout'
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
        <StyledDropdownMenuItem onClick={resetLayout}>
          <RotateCcw className="size-4" aria-hidden />
          <span>{t('panelWorkspace.reset')}</span>
        </StyledDropdownMenuItem>
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
