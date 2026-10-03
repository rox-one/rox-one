/**
 * «Вводные» — everything the person has for this project in one drop zone:
 * files (stored in the project's assets/ folder, the existing project-asset
 * storage), links, pasted text, Rox notes, sessions and workspace sources
 * (referenced by id in roadmap.json). Nothing is fetched or sent anywhere when
 * an input is added.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Database, ExternalLink, FileText, Link2, MessageSquare, NotebookText, Paperclip, Type, Upload, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { roadmapId, type RoadmapInput, type RoadmapInputKind } from '@craft-agent/shared/projects/roadmap'
import type { ProjectAsset } from '@craft-agent/shared/projects/types'
import { IconButton, TextButton } from './roadmap-ui'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export interface PickOption {
  id: string
  title: string
}

const KIND_ICON: Record<RoadmapInputKind, React.ComponentType<{ className?: string }>> = {
  link: Link2,
  text: Type,
  note: NotebookText,
  session: MessageSquare,
  source: Database,
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

const URL_RE = /^https?:\/\/\S+$/i

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function PickMenu({
  label,
  icon: Icon,
  options,
  emptyLabel,
  onPick,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  options: PickOption[]
  emptyLabel: string
  onPick: (option: PickOption) => void
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="end" className="max-h-[320px] max-w-[320px] overflow-y-auto">
        {options.length === 0 ? (
          <div className="px-2 py-1.5 text-[12px] text-muted-foreground">{emptyLabel}</div>
        ) : (
          options.map((o) => (
            <StyledDropdownMenuItem key={o.id} onSelect={() => onPick(o)}>
              <span className="truncate">{o.title}</span>
            </StyledDropdownMenuItem>
          ))
        )}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}

export function ProjectInputs({
  inputs,
  assets,
  iconFilename,
  onInputsChange,
  onUploadFile,
  onDeleteAsset,
  onOpenFile,
  sessionOptions,
  noteOptions,
  sourceOptions,
}: {
  inputs: RoadmapInput[]
  assets: ProjectAsset[]
  iconFilename?: string
  onInputsChange: (next: RoadmapInput[]) => void
  onUploadFile: (file: { filename: string; base64: string }) => Promise<void>
  onDeleteAsset: (asset: ProjectAsset) => void
  onOpenFile: (path: string) => void
  sessionOptions: PickOption[]
  noteOptions: PickOption[]
  sourceOptions: PickOption[]
}) {
  const { t } = useTranslation()
  const [over, setOver] = React.useState(false)
  const [composer, setComposer] = React.useState<null | 'link' | 'text'>(null)
  const [draftValue, setDraftValue] = React.useState('')
  const [draftTitle, setDraftTitle] = React.useState('')
  const [uploading, setUploading] = React.useState(0)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const files = assets.filter((a) => a.filename !== iconFilename)
  const total = files.length + inputs.length

  const addInput = React.useCallback(
    (kind: RoadmapInputKind, value: string, title = '') => {
      if (!value.trim()) return
      if (inputs.some((i) => i.kind === kind && i.value === value)) {
        toast.info(t('projectRoadmap.inputDuplicate'))
        return
      }
      onInputsChange([...inputs, { id: roadmapId('in'), kind, value, title, addedAt: Date.now() }])
    },
    [inputs, onInputsChange, t],
  )

  const uploadFiles = React.useCallback(
    async (list: File[]) => {
      for (const file of list) {
        if (file.size > MAX_UPLOAD_BYTES) {
          toast.error(t('projectRoadmap.fileTooLarge', { name: file.name }))
          continue
        }
        setUploading((n) => n + 1)
        try {
          await onUploadFile({ filename: file.name, base64: await fileToBase64(file) })
        } catch (err) {
          toast.error(t('projectInfo.uploadFailed'), { description: err instanceof Error ? err.message : undefined })
        } finally {
          setUploading((n) => n - 1)
        }
      }
    },
    [onUploadFile, t],
  )

  const acceptText = React.useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      const lines = trimmed.split(/\s+/)
      if (lines.every((l) => URL_RE.test(l))) {
        for (const url of lines) addInput('link', url)
        return
      }
      addInput('text', trimmed)
    },
    [addInput],
  )

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setOver(false)
    const dropped = Array.from(e.dataTransfer.files ?? [])
    if (dropped.length) {
      void uploadFiles(dropped)
      return
    }
    const uri = e.dataTransfer.getData('text/uri-list')
    if (uri) {
      for (const line of uri.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))) addInput('link', line)
      return
    }
    acceptText(e.dataTransfer.getData('text/plain'))
  }

  const onPaste = (e: React.ClipboardEvent) => {
    if ((e.target as HTMLElement).closest('input,textarea')) return
    const pasted = Array.from(e.clipboardData.files ?? [])
    if (pasted.length) {
      e.preventDefault()
      void uploadFiles(pasted)
      return
    }
    const text = e.clipboardData.getData('text/plain')
    if (text) {
      e.preventDefault()
      acceptText(text)
    }
  }

  const openInput = (input: RoadmapInput) => {
    switch (input.kind) {
      case 'link':
        void window.electronAPI.openUrl(input.value)
        break
      case 'note':
        navigate(routes.view.notes(input.value))
        break
      case 'session':
        navigate(routes.view.allSessions(input.value))
        break
      case 'source':
        navigate(routes.view.sources({ sourceSlug: input.value }))
        break
      default:
        break
    }
  }

  const commitComposer = () => {
    if (composer === 'link') {
      const url = draftValue.trim()
      if (!URL_RE.test(url)) {
        toast.error(t('projectRoadmap.linkInvalid'))
        return
      }
      addInput('link', url, draftTitle.trim())
    } else if (composer === 'text') {
      addInput('text', draftValue.trim(), draftTitle.trim())
    }
    setComposer(null)
    setDraftValue('')
    setDraftTitle('')
  }

  return (
    <div
      tabIndex={0}
      data-testid="project-inputs"
      onPaste={onPaste}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).some((type) => type === 'Files' || type === 'text/plain' || type === 'text/uri-list')) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={onDrop}
      className={cn(
        '@container min-w-0 rounded-lg px-2 py-2 outline-none transition-colors focus-visible:bg-foreground/[0.04]',
        over ? 'bg-accent/10' : 'bg-foreground/[0.025]',
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-0.5">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
        >
          <Paperclip className="h-3.5 w-3.5" />
          {t('projectRoadmap.inputFile')}
        </button>
        <button
          type="button"
          onClick={() => setComposer('link')}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
        >
          <Link2 className="h-3.5 w-3.5" />
          {t('projectRoadmap.inputLink')}
        </button>
        <button
          type="button"
          onClick={() => setComposer('text')}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
        >
          <Type className="h-3.5 w-3.5" />
          {t('projectRoadmap.inputText')}
        </button>
        <PickMenu
          label={t('projectRoadmap.inputNote')}
          icon={NotebookText}
          options={noteOptions}
          emptyLabel={t('projectRoadmap.inputNoteEmpty')}
          onPick={(o) => addInput('note', o.id, o.title)}
        />
        <PickMenu
          label={t('projectRoadmap.inputSession')}
          icon={MessageSquare}
          options={sessionOptions}
          emptyLabel={t('projectRoadmap.inputSessionEmpty')}
          onPick={(o) => addInput('session', o.id, o.title)}
        />
        <PickMenu
          label={t('projectRoadmap.inputSource')}
          icon={Database}
          options={sourceOptions}
          emptyLabel={t('projectRoadmap.inputSourceEmpty')}
          onPick={(o) => addInput('source', o.id, o.title)}
        />
        {uploading > 0 ? <span className="ml-auto text-[12px] text-muted-foreground">{t('projectRoadmap.uploading')}</span> : null}
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const list = Array.from(e.target.files ?? [])
            e.target.value = ''
            void uploadFiles(list)
          }}
        />
      </div>

      {composer ? (
        <div className="mt-1 flex min-w-0 flex-col gap-1 rounded-md bg-background/60 p-2">
          {composer === 'link' ? (
            <input
              autoFocus
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitComposer()
                if (e.key === 'Escape') setComposer(null)
              }}
              placeholder="https://…"
              aria-label={t('projectRoadmap.inputLink')}
              className="h-7 rounded-md bg-foreground/[0.04] px-2 text-[13px] outline-none"
            />
          ) : (
            <textarea
              autoFocus
              rows={4}
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitComposer()
                if (e.key === 'Escape') setComposer(null)
              }}
              placeholder={t('projectRoadmap.inputTextPlaceholder')}
              aria-label={t('projectRoadmap.inputText')}
              className="resize-y rounded-md bg-foreground/[0.04] px-2 py-1.5 text-[13px] leading-5 outline-none"
            />
          )}
          <div className="flex min-w-0 items-center gap-1">
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitComposer()
              }}
              placeholder={t('projectRoadmap.inputTitlePlaceholder')}
              aria-label={t('projectRoadmap.inputTitlePlaceholder')}
              className="h-7 min-w-0 flex-1 rounded-md bg-foreground/[0.04] px-2 text-[12px] outline-none"
            />
            <TextButton tone="ghost" onClick={() => setComposer(null)}>{t('common.cancel')}</TextButton>
            <TextButton tone="primary" onClick={commitComposer} disabled={!draftValue.trim()}>{t('projectRoadmap.add')}</TextButton>
          </div>
        </div>
      ) : null}

      {total === 0 && !composer ? (
        <div className="flex min-w-0 items-center gap-2 px-2 py-3 text-[12px] leading-5 text-muted-foreground">
          <Upload className="h-4 w-4 shrink-0 opacity-60" />
          <span>{t('projectRoadmap.inputsEmpty')}</span>
        </div>
      ) : null}

      {total > 0 ? (
        <div className="mt-1 grid min-w-0 grid-cols-1 gap-x-2 @[720px]:grid-cols-2">
          {files.map((asset) => (
            <div key={`file-${asset.filename}`} className="group flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-foreground/[0.04]">
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <button
                type="button"
                onClick={() => onOpenFile(asset.absolutePath)}
                className="min-w-0 flex-1 truncate text-left text-[13px] text-foreground"
                title={asset.filename}
              >
                {asset.filename}
              </button>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatSize(asset.sizeBytes)}</span>
              <IconButton label={t('projectRoadmap.remove')} className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => onDeleteAsset(asset)}>
                <X className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          ))}
          {inputs.map((input) => {
            const Icon = KIND_ICON[input.kind]
            const title = input.title || (input.kind === 'text' ? input.value.replace(/\s+/g, ' ').slice(0, 120) : input.value)
            return (
              <div key={input.id} data-testid="project-input" className="group flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-foreground/[0.04]">
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <button
                  type="button"
                  onClick={() => openInput(input)}
                  disabled={input.kind === 'text'}
                  title={input.kind === 'text' ? input.value.slice(0, 600) : input.value}
                  className="min-w-0 flex-1 truncate text-left text-[13px] text-foreground disabled:cursor-default"
                >
                  {title}
                </button>
                <span className="shrink-0 text-[11px] text-muted-foreground">{t(`projectRoadmap.inputKind.${input.kind}`)}</span>
                {input.kind === 'link' ? <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/60" /> : null}
                <IconButton
                  label={t('projectRoadmap.remove')}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                  onClick={() => onInputsChange(inputs.filter((x) => x.id !== input.id))}
                >
                  <X className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            )
          })}
        </div>
      ) : null}
      {total > 0 ? <p className="mt-1 px-1.5 text-[11px] text-muted-foreground/70">{t('projectRoadmap.inputsDropHint')}</p> : null}
    </div>
  )
}
