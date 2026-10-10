/**
 * С-14 «Студия подкаста» (docs/specs/2026-10-09-dev-space-and-playbooks 04-UI-SPEC B.14,
 * D13). Generation dialog: topic from the selected source/question, engine
 * `system|edge|kokoro` (kokoro only when its CLI is present — `podcast:engines`),
 * optional segment cap, editable two-voice roles. Progress comes
 * from the `podcast:job` push stream; the player and mp3/srt export consume the
 * produced episode (`podcast:episodes`).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Ban, Download, Loader2, Mic2, Play, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MAX_PODCAST_ROLES, MIN_PODCAST_ROLES } from '@rox/shared/voice'
import { useActiveWorkspace } from '@/context/AppShellContext'
import {
  cancelPodcast,
  exportPodcastEpisode,
  listPodcastEpisodes,
  onPodcastJob,
  podcastAudioUrl,
  podcastEngines,
  startPodcast,
  type PodcastEngine,
  type PodcastEnginesResult,
  type PodcastEpisode,
  type PodcastExportFormat,
  type PodcastJob,
  type PodcastRoleTemplate,
} from './podcast-client'
import { loadRolePreset, nextGuestRoleId, saveRolePreset } from './podcast-roles'
import type { StudioRole } from './podcast-roles'

const STAGES: readonly PodcastJob['state'][] = ['queued', 'scripting', 'synthesizing', 'assembling', 'done']

export interface PodcastStudioProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Bound project; omitted → server default `projects/playbooks`. */
  projectSlug?: string
  /** Seed from the notebook: selected source slug and/or the last question. */
  seed: { sourceSlug: string | null; question: string | null }
  /** Fired once when a run reaches `done`, for the home recent-podcasts list. */
  onCompleted?: (info: { jobId: string; topic: string; engine: PodcastEngine }) => void
}

export function PodcastStudio({ open, onOpenChange, projectSlug, seed, onCompleted }: PodcastStudioProps) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const [topic, setTopic] = useState(seed.question ?? '')
  const [engine, setEngine] = useState<PodcastEngine>('system')
  const [engines, setEngines] = useState<PodcastEnginesResult | null>(null)
  const [segmentCap, setSegmentCap] = useState('')
  const [roles, setRoles] = useState<StudioRole[]>(() => loadRolePreset())
  const [job, setJob] = useState<PodcastJob | null>(null)
  const [episode, setEpisode] = useState<PodcastEpisode | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const jobIdRef = useRef<string | null>(null)
  const completedRef = useRef(false)
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false

  useEffect(() => {
    if (open) setTopic(seed.question ?? '')
  }, [open, seed.question])

  // Probe honest engine availability once the dialog opens: a missing kokoro CLI
  // disables the option (with a hint) instead of failing a render at synthesis.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        const result = await podcastEngines()
        if (!cancelled) setEngines(result)
      } catch {
        /* bridge unavailable — keep the optimistic default (system|edge) */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    let dispose: (() => void) | null = null
    try {
      dispose = onPodcastJob((next) => {
        if (jobIdRef.current && next.id !== jobIdRef.current) return
        setJob((current) => (current && current.seq >= next.seq ? current : next))
      })
    } catch {
      /* bridge unavailable — surfaced on start */
    }
    return () => dispose?.()
  }, [open])

  // Player/export become available once the run finishes with an episode id.
  useEffect(() => {
    if (!workspaceId || job?.state !== 'done' || !job.episodeId) return
    let cancelled = false
    void (async () => {
      try {
        const { episodes } = await listPodcastEpisodes({ workspaceId, projectSlug })
        const found = episodes.find((item) => item.id === job.episodeId)
        if (cancelled || !found) return
        setEpisode(found)
        setAudioUrl(await podcastAudioUrl(workspaceId, found))
      } catch {
        /* player stays hidden */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspaceId, projectSlug, job?.state, job?.episodeId])

  useEffect(() => {
    if (job?.state !== 'done' || completedRef.current) return
    completedRef.current = true
    onCompleted?.({ jobId: job.id, topic: topic.trim() || t('playbooks.home.defaultName'), engine })
  }, [job?.state, job?.id, topic, engine, onCompleted, t])

  const stageIndex = useMemo(() => {
    const index = job ? STAGES.indexOf(job.state) : 0
    return Math.max(0, index)
  }, [job])

  const start = async () => {
    if (!workspaceId) return
    setStarting(true)
    setStartError(null)
    setJob(null)
    setEpisode(null)
    setAudioUrl(null)
    completedRef.current = false
    try {
      const cap = Number(segmentCap.trim())
      const roleTemplates: PodcastRoleTemplate[] = roles.map(role => ({ id: role.id, label: role.label.trim(), prompt: '' }))
      saveRolePreset(roles)
      const { jobId } = await startPodcast({
        workspaceId,
        projectSlug,
        source: { kind: 'topic', topic: topic.trim() },
        engine,
        roles: roleTemplates,
        maxSegments: Number.isFinite(cap) && cap > 0 ? cap : undefined,
      })
      jobIdRef.current = jobId
      setJob({ schemaVersion: 1, id: jobId, state: 'queued', seq: 0, totalSegments: 0, doneSegments: 0, engine })
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err))
    } finally {
      setStarting(false)
    }
  }

  const addRole = () => {
    setRoles((current) => {
      const id = nextGuestRoleId(current)
      return id ? [...current, { id, label: '' }] : current
    })
  }

  const removeRole = (index: number) => {
    setRoles((current) => (index === 0 || current.length <= MIN_PODCAST_ROLES ? current : current.filter((_, position) => position !== index)))
  }

  const setRoleLabel = (index: number, label: string) => {
    setRoles((current) => current.map((role, position) => (position === index ? { ...role, label } : role)))
  }

  const cancel = async () => {
    if (!workspaceId || !job) return
    try {
      await cancelPodcast({ workspaceId, jobId: job.id })
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err))
    }
  }

  const exportArtifact = async (format: PodcastExportFormat) => {
    if (!workspaceId || !episode) return
    setExportError(null)
    try {
      await exportPodcastEpisode({ workspaceId, projectSlug, episode, format, defaultPath: `${topic.trim() || 'podcast'}.${format}`, audioUrl })
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    }
  }

  const running = job !== null && job.state !== 'done' && job.state !== 'failed' && job.state !== 'cancelled'
  const total = job?.totalSegments ?? 0
  const determinate = total > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="playbooks-podcast-dialog">
        <DialogHeader>
          <DialogTitle>{t('playbooks.podcast.title')}</DialogTitle>
          <DialogDescription>{t('playbooks.podcast.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="podcast-topic">{t('playbooks.podcast.topicLabel')}</Label>
            <Input
              id="podcast-topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder={t('playbooks.podcast.topicPlaceholder')}
              data-testid="playbooks-podcast-topic"
            />
            {seed.sourceSlug ? (
              <p className="text-caption text-muted-foreground">{t('playbooks.podcast.topicFromSource', { source: seed.sourceSlug })}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="podcast-engine">{t('playbooks.podcast.engineLabel')}</Label>
              <Select value={engine} onValueChange={(value) => setEngine(value as PodcastEngine)}>
                <SelectTrigger id="podcast-engine" data-testid="playbooks-podcast-engine">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">{t('playbooks.podcast.engineSystem')}</SelectItem>
                  <SelectItem value="edge">{t('playbooks.podcast.engineEdge')}</SelectItem>
                  <SelectItem
                    value="kokoro"
                    disabled={engines?.kokoro.available === false}
                    data-testid="playbooks-podcast-engine-kokoro"
                  >
                    {t('playbooks.podcast.engineKokoro')}
                  </SelectItem>
                </SelectContent>
              </Select>
              {offline && engine === 'edge' ? (
                <p className="text-caption text-muted-foreground" role="status">{t('playbooks.podcast.edgeOffline')}</p>
              ) : null}
              {engines?.kokoro.available === false ? (
                <p className="text-caption text-muted-foreground" role="status">{t('playbooks.podcast.kokoroMissing')}</p>
              ) : null}
              {engine === 'kokoro' ? (
                <p className="text-caption text-muted-foreground" role="status">{t('playbooks.podcast.kokoroEnglishOnly')}</p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="podcast-segments">{t('playbooks.podcast.segmentsLabel')}</Label>
              <Input
                id="podcast-segments"
                type="number"
                min={1}
                value={segmentCap}
                onChange={(event) => setSegmentCap(event.target.value)}
                placeholder={t('playbooks.podcast.segmentsPlaceholder')}
                data-testid="playbooks-podcast-segments"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('playbooks.podcast.rolesLabel')}</Label>
            {roles.map((role, index) => {
              const placeholder = role.id === 'host'
                ? t('playbooks.podcast.roleHostPlaceholder')
                : role.id === 'expert' ? t('playbooks.podcast.roleExpertPlaceholder') : t('playbooks.podcast.rolePlaceholder')
              return (
                <div key={role.id} className="flex items-center gap-2">
                  <Input
                    id={`podcast-role-${index}`}
                    value={role.label}
                    onChange={(event) => setRoleLabel(index, event.target.value)}
                    placeholder={placeholder}
                    aria-label={placeholder}
                    data-testid={`playbooks-podcast-role-${index}`}
                  />
                  {index > 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={roles.length <= MIN_PODCAST_ROLES}
                      aria-label={t('playbooks.podcast.removeRole')}
                      onClick={() => removeRole(index)}
                      data-testid={`playbooks-podcast-role-remove-${index}`}
                    >
                      <Trash2 className="icon-caption" aria-hidden />
                    </Button>
                  ) : null}
                </div>
              )
            })}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={addRole} disabled={roles.length >= MAX_PODCAST_ROLES} data-testid="playbooks-podcast-role-add">
                <Plus className="icon-caption" aria-hidden />
                {t('playbooks.podcast.addRole')}
              </Button>
              <p className="text-caption text-muted-foreground" data-testid="playbooks-podcast-roles-hint">{t('playbooks.podcast.rolesHint')}</p>
            </div>
          </div>

          {job ? (
            <div className="rounded-[var(--radius-card)] border border-border-subtle p-3" aria-live="polite" data-testid="playbooks-podcast-progress">
              <div className="mb-2 flex items-center gap-2 text-xs">
                {running ? <Loader2 className="icon-caption animate-spin motion-reduce:animate-none" aria-hidden /> : <Mic2 className="icon-caption" aria-hidden />}
                <span className="font-medium">{t(`playbooks.podcast.stage.${job.state}`)}</span>
                {total > 0 ? (
                  <span className="text-muted-foreground tabular-nums" data-testid="playbooks-podcast-segments-count">
                    {t('playbooks.podcast.segmentsProgress', { done: job.doneSegments, total })}
                  </span>
                ) : null}
                {job.state === 'failed' ? (
                  <span className="ml-auto flex items-center gap-1 text-destructive" role="alert">
                    <AlertCircle className="icon-caption" aria-hidden />
                    {t('playbooks.podcast.failed')}
                  </span>
                ) : null}
                {job.state === 'cancelled' ? (
                  <span className="ml-auto text-muted-foreground" role="status">{t('playbooks.podcast.cancelled')}</span>
                ) : null}
              </div>
              {determinate ? (
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-surface-pressed"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={total}
                  aria-valuenow={job.doneSegments}
                  data-testid="playbooks-podcast-segments-list"
                >
                  <div className="h-full bg-accent transition-[width] duration-[var(--motion-base)] motion-reduce:transition-none" style={{ width: `${Math.round((job.doneSegments / total) * 100)}%` }} />
                </div>
              ) : (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-pressed" role="progressbar" data-testid="playbooks-podcast-segments-list">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-accent motion-reduce:animate-none motion-reduce:w-full" />
                </div>
              )}
              {job.error ? (
                <p className="mt-2 text-xs text-destructive" role="alert" data-testid="playbooks-podcast-error">{t('playbooks.podcast.errorCode', { code: job.error.code })}</p>
              ) : null}
              {audioUrl ? (
                <div className="mt-3 space-y-2">
                  <audio controls src={audioUrl} className="w-full" data-testid="playbooks-podcast-player" />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => void exportArtifact('mp3')} data-testid="playbooks-podcast-export-mp3">
                      <Download className="icon-caption" aria-hidden />
                      {t('playbooks.podcast.exportMp3')}
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={!episode?.srt} onClick={() => void exportArtifact('srt')} data-testid="playbooks-podcast-export-srt">
                      <Download className="icon-caption" aria-hidden />
                      {t('playbooks.podcast.exportSrt')}
                    </Button>
                  </div>
                  {exportError ? <p className="text-xs text-destructive" role="alert">{t('playbooks.podcast.exportFailed', { error: exportError })}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {startError ? <p className="text-xs text-destructive" role="alert" data-testid="playbooks-podcast-start-error">{t('playbooks.podcast.startFailed', { error: startError })}</p> : null}
        </div>

        <DialogFooter>
          {running ? (
            <Button type="button" variant="outline" onClick={() => void cancel()} data-testid="playbooks-podcast-cancel">
              <Ban className="icon-caption" aria-hidden />
              {t('playbooks.podcast.cancel')}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('playbooks.podcast.close')}</Button>
          <Button
            type="button"
            disabled={!workspaceId || starting || topic.trim().length === 0}
            onClick={() => void start()}
            data-testid="playbooks-podcast-start"
          >
            {starting ? <Loader2 className="icon-caption animate-spin motion-reduce:animate-none" aria-hidden /> : <Play className="icon-caption" aria-hidden />}
            {job ? t('playbooks.podcast.regenerate') : t('playbooks.podcast.generate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}