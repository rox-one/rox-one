/**
 * G5 composer «дека» — story: `screen-composer-deck-<preset>`.
 *
 * Fixture for `featureComposerDeckV1Atom` (default OFF): the isolated jotai
 * store is hydrated with the flag ON, then the real `FreeFormInput` renders its
 * deck — attachment tray (file + image), live dictation strip, the 28 px chip
 * row wrapping the real selectors, and the trailing improve / dictate / send
 * group — with error / disabled / empty decks below (§State coverage).
 *
 * The dictation strip is a single live capture session (the same global store
 * the composer publishes to), so while it is active every mounted deck shows
 * the strip; a real app mounts one composer at a time.
 */
import * as React from 'react'
import { Provider as JotaiProvider, createStore, useSetAtom } from 'jotai'
import { definePlaygroundStory } from '@/playground/registry/story-loader'
import { ModalProvider } from '@/context/ModalContext'
import { PLAYGROUND_VIEWPORT_PRESETS, type PlaygroundViewportPresetId } from '@/playground/registry/types'
import { ensureMockElectronAPI, mockSources } from '@/playground/mock-utils'
import { featureComposerDeckV1Atom } from '@/atoms/unified-shell'
import { KEYS, getKeyString } from '@/lib/local-storage'
import { FreeFormInput } from '@/components/app-shell/input/FreeFormInput'
import { setDictationLevel, setDictationSession } from '@/components/app-shell/input/voice-dictation-state'
import type { FileAttachment } from '../../shared/types'

const WORKSPACE_ID = 'screen-composer-deck-workspace'
const noop = () => {}

/** A real 1×1 PNG, base64 — the only inline image the fixture carries. */
const THUMB_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const FILE_ATTACHMENT: FileAttachment = {
  type: 'text',
  path: '/mock/plans.config.ts',
  name: 'plans.config.ts',
  mimeType: 'text/typescript',
  size: 2150,
}

const IMAGE_ATTACHMENT: FileAttachment = {
  type: 'image',
  path: '/mock/screenshot-тарифы.png',
  name: 'screenshot-тарифы.png',
  mimeType: 'image/png',
  size: 188416,
  thumbnailBase64: THUMB_PNG_BASE64,
}

const FAILED_AUDIO_ATTACHMENT: FileAttachment = {
  type: 'audio',
  path: '/mock/standup.m4a',
  name: 'standup.m4a',
  mimeType: 'audio/mp4',
  size: 512000,
  transcript: { status: 'error', text: '', error: 'no-speech' },
}

function HydrateDeckFlag({ enabled }: { enabled: boolean }) {
  const setFlag = useSetAtom(featureComposerDeckV1Atom)
  React.useEffect(() => {
    if (localStorage.getItem(getKeyString(KEYS.featureComposerDeckV1)) === null) setFlag(enabled)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  React.useEffect(() => {
    setFlag(enabled)
  }, [enabled, setFlag])
  return null
}

/** Drives the shared dictation store so the deck's strip shows a live session. */
function useLiveDictation(enabled: boolean) {
  React.useEffect(() => {
    if (!enabled) return
    setDictationSession(true, Date.now() - 12_000)
    setDictationLevel(0.62)
    const timer = window.setInterval(() => setDictationLevel(0.35 + Math.random() * 0.5), 250)
    return () => {
      window.clearInterval(timer)
      setDictationSession(false)
      setDictationLevel(0)
    }
  }, [enabled])
}

function DeckSample({
  label,
  hint,
  attachments,
  value,
  placeholder,
  disabled,
  dictating,
}: {
  label: string
  hint: string
  attachments: FileAttachment[]
  value?: string
  placeholder?: string
  disabled?: boolean
  dictating?: boolean
}) {
  const [model, setModel] = React.useState('rox/r1-max')
  const [permissionMode, setPermissionMode] = React.useState<'safe' | 'ask' | 'allow-all'>('allow-all')
  const [inputValue, setInputValue] = React.useState(value ?? '')
  const [files, setFiles] = React.useState(attachments)
  useLiveDictation(Boolean(dictating))

  return (
    <section className="w-full">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-body font-medium text-text-primary">{label}</h3>
        <span className="text-caption text-text-muted">{hint}</span>
      </div>
      <FreeFormInput
        unstyled={false}
        currentModel={model}
        onModelChange={setModel}
        currentConnection="rox-kimi"
        permissionMode={permissionMode}
        onPermissionModeChange={setPermissionMode}
        onSubmit={noop}
        onStop={noop}
        inputValue={inputValue}
        onInputChange={setInputValue}
        attachmentsValue={files}
        onAttachmentsChange={setFiles}
        sources={mockSources}
        onSourcesChange={noop}
        workingDirectory="/mock/projects/site"
        onWorkingDirectoryChange={noop}
        sessionFolderPath="/mock/sessions/rox-playground"
        sessionId="screen-composer-deck-session"
        workspaceId={WORKSPACE_ID}
        placeholder={placeholder ?? 'Напишите задачу или вставьте ссылку…'}
        contextStatus={{ inputTokens: 84_000, contextWindow: 200_000 }}
        disabled={disabled}
      />
    </section>
  )
}

function ComposerDeckStory() {
  ensureMockElectronAPI()
  return (
    <div className="flex h-full min-h-0 justify-center overflow-auto bg-background px-4 py-5" data-g05="composer-deck">
      <div className="flex w-full max-w-[860px] flex-col gap-8">
        <DeckSample
          label="Обычный набор"
          hint="трей вложений, диктовка, чипы и действия"
          dictating
          attachments={[FILE_ATTACHMENT, IMAGE_ATTACHMENT]}
        />
        <DeckSample
          label="Ошибка"
          hint="строка ошибки над рядом чипов, черновик сохранён"
          attachments={[FAILED_AUDIO_ATTACHMENT]}
        />
        <DeckSample
          label="Недоступно"
          hint="идёт ответ агента, поле заблокировано"
          attachments={[FILE_ATTACHMENT]}
          placeholder="Дождитесь окончания ответа…"
          disabled
        />
        <DeckSample
          label="Пустой набор"
          hint="первый запуск: подсказка вместо вложений"
          attachments={[]}
          placeholder="Опишите задачу: что сделать, где и как проверить результат"
        />
      </div>
    </div>
  )
}

function ComposerDeckDemo() {
  const store = React.useMemo(() => createStore(), [])
  return (
    <JotaiProvider store={store}>
      <HydrateDeckFlag enabled />
      <ModalProvider>
        <ComposerDeckStory />
      </ModalProvider>
    </JotaiProvider>
  )
}

const viewportIds: PlaygroundViewportPresetId[] = ['desktop', 'tablet', 'mobile']

export default viewportIds.map((viewportId) => definePlaygroundStory({
  id: `screen-composer-deck-${viewportId}`,
  name: `Composer Deck Screen (${PLAYGROUND_VIEWPORT_PRESETS[viewportId].name})`,
  category: 'Chat Inputs',
  level: 'Screens',
  description:
    'G5 composer deck (featureComposerDeckV1Atom, default OFF): attachment tray, live dictation strip, the 28 px chip row wrapping the real model / mode / folder / context selectors, and the trailing improve / dictate / send group.',
  component: ComposerDeckDemo,
  props: [],
  layout: 'full',
  viewport: PLAYGROUND_VIEWPORT_PRESETS[viewportId],
}))