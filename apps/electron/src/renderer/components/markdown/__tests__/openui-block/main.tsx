/**
 * OpenUI block browser fixture (real Chromium).
 *
 * Mounts the production `@rox/ui` Markdown with real ```openui fences so the
 * lazy OpenUI chunk, the ROX theme mapping and the block's action wiring run in
 * a browser. The page exposes a small window API the browser test drives to
 * switch programs, toggle streaming, change the block scope and
 * unmount/remount the Markdown.
 */
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { Markdown } from '@rox/ui'
import '@/index.css'

type FixtureScenario = { program: string; isStreaming: boolean }

const COMPLETE_PROGRAM = `root = Card([title, tbl, chart, actions])
title = TextContent("Top languages by users", "large-heavy")
tbl = Table([Col("Language", langs), Col("Users (M)", users)])
langs = ["Python", "TypeScript", "Rust"]
users = [15.7, 4.1, 2.3]
chart = BarChart(langs, [series], "grouped", "Language", "Users (M)")
series = Series("Users (M)", users)
actions = Buttons([btnMore])
btnMore = Button("Tell me more", Action([@ToAssistant("Tell me more about these languages")]), "primary")`

const FORM_PROGRAM = `root = Card([title, form])
title = TextContent("Plan your trip", "large-heavy")
form = Form("trip-planner", formButtons, [fcType, fcNotes])
formButtons = Buttons([btnSubmit])
btnSubmit = Button("Plan my trip", Action([@ToAssistant("Plan a trip based on my choices")]), "primary")
fcType = FormControl("Trip type", tripType, "What kind of trip?")
tripType = RadioGroup("trip-type", [r1, r2], "relaxed")
r1 = RadioItem("Relaxed", "Slow pace, fewer stops", "relaxed")
r2 = RadioItem("Active", "Packed schedule", "active")
fcNotes = FormControl("Notes", notesInput, "Anything else?")
notesInput = Input("notes", "Add notes")`

const INVALID_PROGRAM = `root = Card([title, broken])
title = TextContent("This program is invalid", "large-heavy")
broken = NotARealComponent("x")`

const STREAM_PARTIAL_PROGRAM = `root = Card([title, form])
title = TextContent("Streaming form", "large-heavy")
form = Form("stream-form", formButtons, [fcType])
formButtons = Buttons([btnSubmit])
btnSubmit = Button("Submit", Action([@ToAssistant("Submit the streamed form")]), "primary")
fcType = FormControl("Trip type", tripType, "Pick one")
tripType = RadioGroup("trip-type", [r1], "relaxed")
r1 = RadioItem("Relaxed", "Slow pace", "relaxed")`

const STREAM_FULL_PROGRAM = `root = Card([title, form])
title = TextContent("Streaming form", "large-heavy")
form = Form("stream-form", formButtons, [fcType, fcNotes])
formButtons = Buttons([btnSubmit])
btnSubmit = Button("Submit", Action([@ToAssistant("Submit the streamed form")]), "primary")
fcType = FormControl("Trip type", tripType, "Pick one")
tripType = RadioGroup("trip-type", [r1, r2], "relaxed")
r1 = RadioItem("Relaxed", "Slow pace", "relaxed")
r2 = RadioItem("Active", "Packed schedule", "active")
fcNotes = FormControl("Notes", notesInput, "Anything else?")
notesInput = Input("notes", "Add notes")`

const PROGRAM_BY_NAME: Record<string, string> = {
  complete: COMPLETE_PROGRAM,
  form: FORM_PROGRAM,
  invalid: INVALID_PROGRAM,
  empty: '',
  'stream-partial': STREAM_PARTIAL_PROGRAM,
  'stream-full': STREAM_FULL_PROGRAM,
}

const query = new URLSearchParams(location.search)
document.documentElement.classList.add(query.get('mode') === 'dark' ? 'dark' : 'light')

// Fixture translation resources: the three OpenUI keys resolve to deterministic
// sentinels so the browser test never depends on the shipped locale copy.
const translationsReady = i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  keySeparator: false,
  interpolation: { escapeValue: false },
  resources: {
    en: {
      translation: {
        'openui.label': 'OPENUI_LABEL',
        'openui.loading': 'OPENUI_LOADING',
        'openui.renderError': 'OPENUI_RENDER_ERROR',
      },
    },
  },
})

const prompts: string[] = []
const urls: string[] = []

// Message/turn identity passed as Markdown's `blockScope`. The `scope` query
// param lets the test mount the same program under different scopes.
const state: FixtureScenario & {
  scope?: string
  apply?: (next: FixtureScenario) => void
  applyScope?: (scope: string | undefined) => void
} = {
  program: PROGRAM_BY_NAME[query.get('program') ?? ''] ?? COMPLETE_PROGRAM,
  isStreaming: query.get('streaming') === 'true',
  scope: query.get('scope') ?? undefined,
}

let root: Root | null = null
let host: HTMLElement | null = null

function mount(): void {
  // A fresh host per mount keeps unmount/remount a genuine remount rather than
  // a second createRoot on a container React already owns.
  host = document.createElement('div')
  host.setAttribute('data-openui-fixture-host', '')
  document.body.appendChild(host)
  root = createRoot(host)
  root.render(<Fixture />)
}

function unmount(): void {
  root?.unmount()
  root = null
  host?.remove()
  host = null
}

function Fixture(): React.ReactElement {
  const [scenario, setScenario] = React.useState<FixtureScenario>({ program: state.program, isStreaming: state.isStreaming })
  const [scope, setScope] = React.useState<string | undefined>(state.scope)

  // Expose the live state to the driving test; identity is stable across renders.
  React.useEffect(() => {
    state.apply = setScenario
    state.applyScope = setScope
  }, [])

  // A real ```openui fence so the fixture exercises Markdown's fence dispatch,
  // not a plain-code render of the program text.
  return (
    <div data-testid="openui-fixture" style={{ width: 900, padding: 24 }}>
      <Markdown
        mode="minimal"
        isStreaming={scenario.isStreaming}
        onSendPrompt={(text) => { prompts.push(text) }}
        onUrlClick={(url) => { urls.push(url) }}
        blockScope={scope}
      >
        {['```openui', scenario.program, '```'].join('\n')}
      </Markdown>
    </div>
  )
}

const fixture = {
  prompts,
  urls,
  setScenario(program: string, isStreaming: boolean) {
    state.program = program
    state.isStreaming = isStreaming
    state.apply?.({ program, isStreaming })
  },
  setScope(scope: string | undefined) {
    state.scope = scope
    state.applyScope?.(scope)
  },
  program(name: string) {
    const program = PROGRAM_BY_NAME[name]
    if (program === undefined) throw new Error(`Unknown fixture program: ${name}`)
    return program
  },
  unmount,
  mount,
}
// Well-known window global extension for the driving browser test; the page is
// the only writer and the test is the only reader.
const openuiGlobal = window as unknown as { __openuiFixture: typeof fixture }
openuiGlobal.__openuiFixture = fixture

void translationsReady.then(() => { mount() })