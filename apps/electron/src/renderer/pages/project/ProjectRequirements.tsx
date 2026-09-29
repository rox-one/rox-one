/**
 * Requirements split by kind (функциональные / технические / количественные /
 * качественные), each with verifiable acceptance criteria and an optional
 * milestone link.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Flag, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import {
  REQUIREMENT_KINDS,
  roadmapId,
  type RequirementKind,
  type RoadmapMilestone,
  type RoadmapRequirement,
} from '@craft-agent/shared/projects/roadmap'
import { AddRow, IconButton, InlineInput } from './roadmap-ui'

function MilestonePicker({
  milestones,
  value,
  onChange,
}: {
  milestones: RoadmapMilestone[]
  value?: string
  onChange: (id: string | undefined) => void
}) {
  const { t } = useTranslation()
  const current = milestones.find((m) => m.id === value)
  if (!milestones.length) return null
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t('projectRoadmap.linkMilestone')}
          className={cn(
            'inline-flex h-6 max-w-[140px] shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] hover:bg-foreground/[0.06]',
            current ? 'text-foreground/70' : 'text-muted-foreground/60 opacity-0 group-hover:opacity-100 focus:opacity-100',
          )}
        >
          <Flag className="h-3 w-3 shrink-0" />
          <span className="truncate">{current ? current.title : t('projectRoadmap.linkMilestone')}</span>
        </button>
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="end">
        {milestones.map((m) => (
          <StyledDropdownMenuItem key={m.id} onSelect={() => onChange(m.id)}>
            {m.title}
          </StyledDropdownMenuItem>
        ))}
        {current ? (
          <>
            <StyledDropdownMenuSeparator />
            <StyledDropdownMenuItem onSelect={() => onChange(undefined)}>{t('projectRoadmap.unlinkMilestone')}</StyledDropdownMenuItem>
          </>
        ) : null}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}

function RequirementRow({
  requirement,
  milestones,
  onChange,
  onRemove,
}: {
  requirement: RoadmapRequirement
  milestones: RoadmapMilestone[]
  onChange: (next: RoadmapRequirement) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="min-w-0 py-0.5" data-testid="project-requirement">
      <div className="group flex min-w-0 items-center gap-1">
        <span className="mx-1.5 h-1 w-1 shrink-0 rounded-full bg-foreground/40" />
        <InlineInput
          value={requirement.text}
          ariaLabel={t('projectRoadmap.requirementText')}
          onCommit={(text) => (text ? onChange({ ...requirement, text }) : onRemove())}
        />
        <MilestonePicker
          milestones={milestones}
          value={requirement.milestoneId}
          onChange={(milestoneId) => onChange({ ...requirement, milestoneId })}
        />
        <IconButton label={t('projectRoadmap.remove')} className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={onRemove}>
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <div className="ml-4 flex flex-col">
        {requirement.acceptance.map((line, index) => (
          <div key={`${index}-${line}`} className="group flex min-w-0 items-center gap-1">
            <span className="shrink-0 pl-1 text-[11px] text-success/80" aria-hidden>✓</span>
            <InlineInput
              value={line}
              ariaLabel={t('projectRoadmap.acceptance')}
              className="h-6 text-[12px] text-muted-foreground"
              onCommit={(text) =>
                onChange({
                  ...requirement,
                  acceptance: text
                    ? requirement.acceptance.map((x, i) => (i === index ? text : x))
                    : requirement.acceptance.filter((_, i) => i !== index),
                })
              }
            />
            <IconButton
              label={t('projectRoadmap.remove')}
              className="opacity-0 group-hover:opacity-100"
              onClick={() => onChange({ ...requirement, acceptance: requirement.acceptance.filter((_, i) => i !== index) })}
            >
              <X className="h-3 w-3" />
            </IconButton>
          </div>
        ))}
        <AddRow
          className="h-6 [&_input]:h-6 [&_input]:text-[12px]"
          placeholder={t('projectRoadmap.addAcceptancePlaceholder')}
          onAdd={(text) => onChange({ ...requirement, acceptance: [...requirement.acceptance, text] })}
        />
      </div>
    </div>
  )
}

export function ProjectRequirements({
  requirements,
  milestones,
  onChange,
}: {
  requirements: RoadmapRequirement[]
  milestones: RoadmapMilestone[]
  onChange: (next: RoadmapRequirement[]) => void
}) {
  const { t } = useTranslation()
  const byKind = (kind: RequirementKind) => requirements.filter((r) => r.kind === kind)
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2 @[760px]:grid-cols-2" data-testid="project-requirements">
      {REQUIREMENT_KINDS.map((kind) => {
        const items = byKind(kind)
        return (
          <div key={kind} className="@container min-w-0 rounded-lg bg-foreground/[0.025] px-2 py-2" data-testid={`project-requirements-${kind}`}>
            <div className="flex items-baseline gap-2 px-1 pb-1">
              <span className="text-[12px] font-semibold text-foreground/85">{t(`projectRoadmap.requirementKind.${kind}`)}</span>
              {items.length ? <span className="text-[11px] tabular-nums text-muted-foreground">{items.length}</span> : null}
              <span className="ml-auto hidden truncate text-[11px] text-muted-foreground/70 @[300px]:inline">
                {t(`projectRoadmap.requirementKindHint.${kind}`)}
              </span>
            </div>
            {items.map((r) => (
              <RequirementRow
                key={r.id}
                requirement={r}
                milestones={milestones}
                onChange={(next) => onChange(requirements.map((x) => (x.id === r.id ? next : x)))}
                onRemove={() => onChange(requirements.filter((x) => x.id !== r.id))}
              />
            ))}
            <AddRow
              placeholder={t('projectRoadmap.addRequirementPlaceholder')}
              onAdd={(text) => onChange([...requirements, { id: roadmapId('rq'), kind, text, acceptance: [] }])}
            />
          </div>
        )
      })}
    </div>
  )
}
