/**
 * MarkdownOpenUIBlock - renders ```openui fences as interactive OpenUI trees.
 *
 * The fence body is an OpenUI Lang program; `Renderer` from
 * `@openuidev/react-lang` parses it against `openuiChatLibrary` and paints the
 * components. Everything runs client-side — no Gateway, no network, no tool
 * provider — so `Query()`/`Mutation()` calls are simply unavailable.
 *
 * Behaviour:
 * - a cheap static guard (`estimateOpenUIProgram`) runs on every program
 *   before the parser is mounted: an over-budget program (the vendor parser
 *   inlines references, so short fences can expand exponentially) never
 *   reaches `Renderer` and settles onto the notice + code fallback instead.
 * - while the message is still streaming the `Renderer` re-parses the growing
 *   string; until the first renderable root arrives a quiet placeholder row is
 *   shown and form controls stay disabled (`isStreaming`).
 * - parse/render errors are only surfaced after streaming ends; the block then
 *   shows a muted notice and falls back to the plain code block. A React error
 *   boundary provides the same notice + fallback if a component throws.
 * - form state is persisted per `blockScope|blockId` (bounded LRU) so a block
 *   that is re-mounted by a streaming re-render keeps what the user typed; the
 *   scope keeps one message's state from hydrating another's.
 *
 * Styling comes from `@openuidev/react-ui/styles/index.css` (loaded with this
 * lazily-imported module) themed through the ROX token bridge in
 * `openui-theme.ts`.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  BuiltinActionType,
  Renderer,
  type ActionEvent,
  type OpenUIError,
  type ParseResult,
} from '@openuidev/react-lang'
import { ThemeProvider } from '@openuidev/react-ui'
import { openuiChatLibrary } from '@openuidev/react-ui/genui-lib'
import '@openuidev/react-ui/styles/index.css'
import 'katex/dist/katex.min.css'
import { cn } from '../../lib/utils'
import { CodeBlock } from './CodeBlock'
import { estimateOpenUIProgram } from './openui-program-guard'
import { useRoxOpenUITheme } from './openui-theme'

export interface MarkdownOpenUIBlockProps {
  /** Fence body — an OpenUI Lang program. */
  code: string
  className?: string
  /** The surrounding message is still streaming. */
  isStreaming?: boolean
  /** Stable block id (from Markdown's wrapBlock hash) for form-state persistence. */
  blockId?: string
  /**
   * Identity of the owning message/turn. `blockId` is derived from the fence
   * content, which churns as the message streams, so the scope keeps form
   * state (and the rendered/placeholder decision) keyed to the block's life
   * rather than to a transient hash.
   */
  blockScope?: string
  /** `@ToAssistant` follow-up → next user message. */
  onSendPrompt?: (text: string) => void
  /** `OpenUrl` actions → the existing ROX URL routing. */
  onUrlClick?: (url: string) => void
}

// ── Form-state persistence ───────────────────────────────────────────────────
// Module-level and bounded: at most FORM_STATE_CAP blocks keep their state,
// least-recently touched evicted first.

const FORM_STATE_CAP = 32
const formStateStore = new Map<string, Record<string, unknown>>()

/**
 * Persistence key for a block's form state. Content-hash `blockId`s collide
 * across messages, so the owning scope disambiguates them.
 */
export function openUIFormStateKey(blockScope: string | undefined, blockId: string | undefined): string {
  return `${blockScope ?? ''}|${blockId ?? ''}`
}

/**
 * A non-null, non-array object — the shape both a form group and a field entry
 * take in the renderer's store.
 */
function isStoreRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * The renderer's store snapshot is `{field: {value, componentType}}`, but a
 * form submit wraps it once under the form name:
 * `{formName: {field: {value, componentType}}}` (vendor `getFormPayload`). The
 * follow-up message only needs the submitted `{field: value}` map, so a
 * form-named group is unwrapped one level; entries that already carry a
 * `value` (or scalars such as `$`-bindings) pass through.
 */
export function extractOpenUIFormValues(formState: Record<string, unknown>): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(formState)) {
    if (isStoreRecord(entry) && 'value' in entry) {
      values[key] = entry.value
    } else if (isStoreRecord(entry)) {
      for (const [field, fieldEntry] of Object.entries(entry)) {
        values[field] = isStoreRecord(fieldEntry) && 'value' in fieldEntry ? fieldEntry.value : fieldEntry
      }
    } else {
      values[key] = entry
    }
  }
  return values
}

function readOpenUIFormState(blockId: string): Record<string, unknown> | undefined {
  const state = formStateStore.get(blockId)
  if (state === undefined) return undefined
  // Refresh recency (Map preserves insertion order).
  formStateStore.delete(blockId)
  formStateStore.set(blockId, state)
  return state
}

function writeOpenUIFormState(blockId: string, state: Record<string, unknown>): void {
  formStateStore.delete(blockId)
  formStateStore.set(blockId, state)
  while (formStateStore.size > FORM_STATE_CAP) {
    const oldest = formStateStore.keys().next().value
    if (oldest === undefined) break
    formStateStore.delete(oldest)
  }
}

// ── Error boundary ───────────────────────────────────────────────────────────

class OpenUIErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode; resetKey: string },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error: Error) {
    console.warn('[MarkdownOpenUIBlock] render failed, falling back to code block:', error)
  }
  componentDidUpdate(prev: { resetKey: string }) {
    // A new program (streaming tick / different block) gets a fresh attempt.
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false })
    }
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}

// ── Main component ───────────────────────────────────────────────────────────

const CONTAINER_CLASS =
  'relative rounded-[var(--radius-card)] border border-border-subtle bg-surface-elevated/40 overflow-hidden'

export function MarkdownOpenUIBlock({
  code,
  className,
  isStreaming,
  blockId,
  blockScope,
  onSendPrompt,
  onUrlClick,
}: MarkdownOpenUIBlockProps) {
  const { t } = useTranslation()
  const { mode, lightTheme, darkTheme } = useRoxOpenUITheme()

  const stateKey = blockId ? openUIFormStateKey(blockScope, blockId) : undefined
  // The block's identity: the owning scope if the caller provides one (stable
  // across streaming ticks), otherwise the content-hash id.
  const blockIdentity = blockScope ?? blockId ?? ''

  // Reject over-budget programs before the parser is ever mounted. The vendor
  // parser inlines references (exponential expansion) and re-parses on every
  // streaming tick, so this must run for every program the block receives.
  const estimate = React.useMemo(() => estimateOpenUIProgram(code), [code])

  // Renderer returns null until the parse yields a renderable root. Once a
  // root has appeared it stays "seen" for the life of the block identity, so a
  // mid-stream parse that momentarily loses the root cannot flip the block
  // back to the placeholder. Identity changes reset it.
  const [rootState, setRootState] = React.useState<{ identity: string; hasRoot: boolean }>(() => ({
    identity: blockIdentity,
    hasRoot: false,
  }))
  const hasRoot = rootState.identity === blockIdentity && rootState.hasRoot
  const [hasErrors, setHasErrors] = React.useState(false)

  const handleParseResult = React.useCallback((result: ParseResult | null) => {
    setRootState((prev) => {
      const seen = prev.identity === blockIdentity ? prev.hasRoot : false
      const next = seen || result?.root != null
      if (prev.identity === blockIdentity && prev.hasRoot === next) return prev
      return { identity: blockIdentity, hasRoot: next }
    })
  }, [blockIdentity])

  const handleError = React.useCallback((errors: OpenUIError[]) => {
    setHasErrors(errors.length > 0)
  }, [])

  const handleStateUpdate = React.useCallback((state: Record<string, unknown>) => {
    // Forms are disabled while streaming and the content-hash key churns on
    // every tick; persisting then would only evict useful entries.
    if (isStreaming || stateKey === undefined) return
    writeOpenUIFormState(stateKey, state)
  }, [isStreaming, stateKey])

  const handleAction = React.useCallback((event: ActionEvent) => {
    if (event.type === BuiltinActionType.ContinueConversation) {
      const formState = event.formState && Object.keys(event.formState).length > 0 ? event.formState : null
      onSendPrompt?.(
        formState
          ? `${event.humanFriendlyMessage}\n\n${JSON.stringify(extractOpenUIFormValues(formState))}`
          : event.humanFriendlyMessage,
      )
      return
    }
    if (event.type === BuiltinActionType.OpenUrl) {
      const url = String(event.params?.url ?? '')
      if (url) onUrlClick?.(url)
    }
  }, [onSendPrompt, onUrlClick])

  // Hydrate persisted form state once streaming has ended (forms are disabled
  // while streaming, so there is nothing to restore until then). Re-read
  // whenever the persistence key changes; kept stable for the same key so a
  // later `undefined` would not re-seed the store.
  const initialStateRef = React.useRef<{ key: string; state: Record<string, unknown> } | null>(null)
  const initialState = React.useMemo(() => {
    if (isStreaming || stateKey === undefined) return undefined
    let cached = initialStateRef.current
    if (cached === null || cached.key !== stateKey) {
      cached = { key: stateKey, state: readOpenUIFormState(stateKey) ?? {} }
      initialStateRef.current = cached
    }
    return cached.state
  }, [isStreaming, stateKey])

  const codeFallback = <CodeBlock code={code} language="openui" mode="full" className={className} />
  const renderError = (
    <>
      <p className="px-3 py-2 text-base text-text-muted" data-ca-openui-notice="render-error">
        {t('openui.renderError')}
      </p>
      {codeFallback}
    </>
  )

  if (!isStreaming && code.trim().length === 0) {
    // Empty fence: nothing to parse and nothing to report — a bordered box
    // with only chrome would be permanent dead space.
    return (
      <div className={cn(CONTAINER_CLASS, className)} role="group" aria-label={t('openui.label')}>
        {codeFallback}
      </div>
    )
  }

  if (!estimate.ok) {
    return (
      <div className={cn(CONTAINER_CLASS, className)} role="group" aria-label={t('openui.label')}>
        {renderError}
      </div>
    )
  }

  if (!isStreaming && hasErrors) {
    return (
      <div className={cn(CONTAINER_CLASS, className)} role="group" aria-label={t('openui.label')}>
        {renderError}
      </div>
    )
  }

  return (
    <div className={cn(CONTAINER_CLASS, className)} role="group" aria-label={t('openui.label')}>
      {isStreaming && !hasRoot && (
        <div className="flex items-center gap-2 px-3 py-3" data-ca-openui-loading>
          <span
            className="h-3 w-3 rounded-[var(--radius-sm)] bg-surface-hover motion-safe:animate-pulse"
            aria-hidden="true"
          />
          <span className="text-base text-text-muted">{t('openui.loading')}</span>
        </div>
      )}
      <OpenUIErrorBoundary fallback={renderError} resetKey={code}>
        <ThemeProvider mode={mode} lightTheme={lightTheme} darkTheme={darkTheme}>
          <div className="p-3">
            <Renderer
              response={code}
              library={openuiChatLibrary}
              isStreaming={!!isStreaming}
              onAction={handleAction}
              onError={handleError}
              onParseResult={handleParseResult}
              onStateUpdate={handleStateUpdate}
              initialState={initialState}
            />
          </div>
        </ThemeProvider>
      </OpenUIErrorBoundary>
    </div>
  )
}