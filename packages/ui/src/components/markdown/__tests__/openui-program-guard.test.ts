/**
 * Static cost guard: the vendor parser inlines references, so a short fence
 * can expand exponentially and freeze the thread. These tests pin the budget
 * contract (accept normal programs, reject doubling chains) and the guard's
 * totality — deterministic, never throwing on partial/streaming text.
 */
import { describe, expect, it } from 'bun:test'
import {
  OPENUI_PROGRAM_BUDGET,
  estimateOpenUIProgram,
} from '../openui-program-guard'

const NORMAL_PROGRAM = [
  'root = Card([title, tbl])',
  'title = TextContent("Top Languages", "large-heavy")',
  'tbl = Table([Col("Language", langs), Col("Users (M)", users)])',
  'langs = ["Python", "TypeScript"]',
  'users = [15.7, 4.1]',
].join('\n')

/** 18+ statements, each doubling the previous definition's size. */
function buildDoublingProgram(statements = 20): string {
  const lines = ['s0 = TextContent("x")']
  for (let i = 1; i <= statements; i += 1) {
    lines.push(`s${i} = Card([s${i - 1}, s${i - 1}])`)
  }
  return lines.join('\n')
}

/**
 * The same doubling, but each reference sits on its own line inside the
 * brackets — the vendor scanner joins these into one statement, so a
 * line-based split would undercount every ref to 1.
 */
function buildMultilineDoublingProgram(statements = 22): string {
  const lines = ['s0 = TextContent("x")']
  for (let i = 1; i <= statements; i += 1) {
    lines.push(`s${i} = Card([`)
    lines.push(`s${i - 1},`)
    lines.push(`s${i - 1}`)
    lines.push('])')
  }
  lines.push('root = Card([')
  lines.push(`s${statements}`)
  lines.push('])')
  return lines.join('\n')
}

/** Doubling refs hidden after a raw newline inside a quoted string. */
function buildMultilineStringDoublingProgram(statements = 20): string {
  const lines = ['s0 = TextContent("x")']
  for (let i = 1; i <= statements; i += 1) {
    lines.push(`s${i} = Card(["a`)
    lines.push(`b", s${i - 1}, s${i - 1}])`)
  }
  return lines.join('\n')
}

/** Doubling refs spread over a ternary continuation (`?` on its own line). */
function buildTernaryDoublingProgram(statements = 20): string {
  const lines = ['s0 = TextContent("x")']
  for (let i = 1; i <= statements; i += 1) {
    lines.push(`s${i} = s${i - 1}`)
    lines.push(`? s${i - 1}`)
    lines.push(`: s${i - 1}`)
  }
  return lines.join('\n')
}

/** An ordinary program whose every statement spans several physical lines. */
const MULTILINE_OK = [
  'root = Card([',
  'title,',
  'tbl',
  '])',
  'title = TextContent("Top Languages", "large-heavy")',
  'tbl = Table([',
  'Col("Language", langs),',
  'Col("Users (M)", users)',
  '])',
  'langs = ["Python", "TypeScript"]',
  'users = [15.7, 4.1]',
].join('\n')

describe('estimateOpenUIProgram', () => {
  it('accepts a normal program and counts its statements', () => {
    const estimate = estimateOpenUIProgram(NORMAL_PROGRAM)
    expect(estimate.ok).toBe(true)
    expect(estimate.statements).toBe(5)
    expect(estimate.nodes).toBeGreaterThan(0)
    expect(estimate.nodes).toBeLessThanOrEqual(OPENUI_PROGRAM_BUDGET.maxNodes)
  })

  it('trips on the doubling program (18+ doubling statements)', () => {
    const estimate = estimateOpenUIProgram(buildDoublingProgram(20))
    expect(estimate.ok).toBe(false)
    expect(estimate.nodes).toBeGreaterThan(OPENUI_PROGRAM_BUDGET.maxNodes)
    expect(estimate.statements).toBe(21)
  })

  it('trips on a multi-line doubling program (bracket-joined statements)', () => {
    const program = buildMultilineDoublingProgram(22)
    const estimate = estimateOpenUIProgram(program)
    expect(estimate.ok).toBe(false)
    expect(estimate.nodes).toBeGreaterThan(OPENUI_PROGRAM_BUDGET.maxNodes)
    // Each `s{i} = Card([ ... ])` is one statement, plus the root and `s0`.
    expect(estimate.statements).toBe(24)
  })

  it('trips when the doubling refs hide behind a raw newline inside a string', () => {
    const estimate = estimateOpenUIProgram(buildMultilineStringDoublingProgram(20))
    expect(estimate.ok).toBe(false)
    expect(estimate.nodes).toBeGreaterThan(OPENUI_PROGRAM_BUDGET.maxNodes)
  })

  it('trips when doubling refs span a ternary continuation', () => {
    const estimate = estimateOpenUIProgram(buildTernaryDoublingProgram(20))
    expect(estimate.ok).toBe(false)
    expect(estimate.nodes).toBeGreaterThan(OPENUI_PROGRAM_BUDGET.maxNodes)
  })

  it('keeps an ordinary multi-line program within budget, unchanged vs single line', () => {
    const multiline = estimateOpenUIProgram(MULTILINE_OK)
    const singleLine = estimateOpenUIProgram(NORMAL_PROGRAM)
    expect(multiline.ok).toBe(true)
    expect(multiline.statements).toBe(singleLine.statements)
    expect(multiline.nodes).toBe(singleLine.nodes)
  })

  it('is not fooled by an unbalanced bracket hidden in a comment', () => {
    const lines = buildDoublingProgram(20).split('\n')
    lines.splice(1, 0, '# ([{')
    lines.splice(2, 0, '// )]}')
    expect(estimateOpenUIProgram(lines.join('\n')).ok).toBe(false)
  })

  it('does not count statements hidden in comments', () => {
    const estimate = estimateOpenUIProgram(
      ['s0 = TextContent("x")', '# s1 = Card([s0, s0])', '// s2 = Card([s1, s1])'].join('\n'),
    )
    expect(estimate.statements).toBe(1)
    expect(estimate.ok).toBe(true)
  })

  it('rejects a program with too many statements even when each is tiny', () => {
    const lines: string[] = []
    for (let i = 0; i <= OPENUI_PROGRAM_BUDGET.maxStatements; i += 1) {
      lines.push(`s${i} = TextContent("x")`)
    }
    const estimate = estimateOpenUIProgram(lines.join('\n'))
    expect(estimate.statements).toBe(OPENUI_PROGRAM_BUDGET.maxStatements + 1)
    expect(estimate.ok).toBe(false)
  })

  it('is deterministic', () => {
    expect(estimateOpenUIProgram(NORMAL_PROGRAM)).toEqual(estimateOpenUIProgram(NORMAL_PROGRAM))
    expect(estimateOpenUIProgram(buildDoublingProgram(20))).toEqual(
      estimateOpenUIProgram(buildDoublingProgram(20)),
    )
  })

  it('never throws and stays finite on every partial/streaming prefix', () => {
    for (let end = 0; end <= NORMAL_PROGRAM.length; end += 1) {
      const partial = NORMAL_PROGRAM.slice(0, end)
      const first = estimateOpenUIProgram(partial)
      const second = estimateOpenUIProgram(partial)
      expect(first).toEqual(second)
      expect(Number.isFinite(first.nodes)).toBe(true)
      expect(Number.isFinite(first.statements)).toBe(true)
    }
    // An unterminated string/expression mid-token must not throw either.
    expect(() => estimateOpenUIProgram('root = Card([s0, "unterminated')).not.toThrow()
  })

  it('ignores blank lines and non-statement lines', () => {
    const estimate = estimateOpenUIProgram(['', '# a comment', 'not a statement', 'a = TextContent("x")'].join('\n'))
    expect(estimate.statements).toBe(1)
    expect(estimate.ok).toBe(true)
  })

  it('saturates and rejects self-referential and mutually-referential names', () => {
    // The fixed point never converges over a reference cycle; the vendor keeps
    // such programs finite via path-scoped cuts but the growth is unbounded, so
    // the honest upper bound is a rejection. The estimate stays finite.
    const estimate = estimateOpenUIProgram(['a = Card([a])', 'b = Card([a, b])'].join('\n'))
    expect(Number.isFinite(estimate.nodes)).toBe(true)
    expect(estimate.ok).toBe(false)
  })

  it('trips on a reverse-order doubling chain (references defined later)', () => {
    // `root` references `s1`, `s1` references `s2` twice, ... `s20` is a leaf.
    // A forward-only pass counts every forward reference as 1 and misses the
    // 2^19 expansion the vendor actually performs.
    const lines = ['root = Card([s1])']
    for (let i = 1; i < 20; i += 1) lines.push(`s${i} = Card([s${i + 1}, s${i + 1}])`)
    lines.push('s20 = TextContent("x")')
    const estimate = estimateOpenUIProgram(lines.join('\n'))
    expect(estimate.ok).toBe(false)
    expect(estimate.nodes).toBeGreaterThan(OPENUI_PROGRAM_BUDGET.maxNodes)
  })

  it('trips on the @Each fan-out shape (template repeated per array element)', () => {
    // The vendor evaluates the Each template once per element; a 3000-element
    // literal array times a 100-item template is ~1.4M rendered nodes.
    const template =
      'Col("c", [' +
      Array.from({ length: 100 }, (_, i) => `TextContent("t${i}")`).join(', ') +
      '])'
    const rows = Array.from({ length: 3000 }, (_, i) => i).join(', ')
    const estimate = estimateOpenUIProgram(
      `rows = [${rows}]\nroot = Card([Table([Col("data", @Each(rows, "r", ${template}))])])`,
    )
    expect(estimate.ok).toBe(false)
    expect(estimate.nodes).toBeGreaterThan(OPENUI_PROGRAM_BUDGET.maxNodes)
  })

  it('handles a large whitespace-only program in a single pass', () => {
    // 200 KB of newlines took the old peek-from-every-newline scan ~40s; the
    // suite timeout is the regression lock. A single-pass scan returns at once.
    const estimate = estimateOpenUIProgram('\n'.repeat(200_000))
    expect(estimate.ok).toBe(true)
    expect(estimate.statements).toBe(0)
    expect(estimate.nodes).toBe(0)
  })

  it('allows a legitimate literal @Each program', () => {
    const estimate = estimateOpenUIProgram(
      [
        'rows = [1, 2, 3]',
        'root = Card([Table([Col("Actions", @Each(rows, "t", Button("Edit", Action([@Set($id, t.id)]))))])])',
      ].join('\n'),
    )
    expect(estimate.ok).toBe(true)
  })

  it('allows a runtime-array @Each program (array length unknown statically)', () => {
    const estimate = estimateOpenUIProgram(
      [
        'root = Card([Col("Actions", @Each(rows, "item", Comp(item.field)))])',
      ].join('\n'),
    )
    expect(estimate.ok).toBe(true)
  })

  it('trips on an indirect @Each fan-out (literal array through @Filter)', () => {
    // The outer array is an `@Filter` call, not a literal; today the operand is
    // what bounds the result (Filter never grows its input), so the 3000-element
    // literal still multiplies the template.
    const template =
      'Col("c", [' +
      Array.from({ length: 100 }, (_, i) => `TextContent("t${i}")`).join(', ') +
      '])'
    const rows = Array.from({ length: 3000 }, (_, i) => i).join(', ')
    const estimate = estimateOpenUIProgram(
      `rows = [${rows}]\nroot = Card([Table([Col("data", @Each(@Filter(rows, "v", ">", 0), "r", ${template}))])])`,
    )
    expect(estimate.ok).toBe(false)
    expect(estimate.nodes).toBeGreaterThan(OPENUI_PROGRAM_BUDGET.maxNodes)
  })

  it('allows ordinary builtin use in a small program', () => {
    const estimate = estimateOpenUIProgram(
      [
        'rows = [1, 2, 3]',
        'top = @First(rows)',
        'loop = @Each(@Filter(rows, "v", ">", 1), "r", TextContent(r))',
        'root = Card([Table([Col("all", rows), Col("big", @Filter(rows, "v", ">", 1)), Col("n", @Count(rows)), Col("f", top), Col("l", loop)])])',
      ].join('\n'),
    )
    expect(estimate.ok).toBe(true)
  })

  it('allows the app browser-suite fixture programs (forward references)', () => {
    // The real fixtures the app's browser suite mounts; they use forward
    // references, the pattern a fixed point is most likely to over-reject.
    const fixtures: Record<string, string> = {
      complete: [
        'root = Card([title, tbl, chart, actions])',
        'title = TextContent("Top languages by users", "large-heavy")',
        'tbl = Table([Col("Language", langs), Col("Users (M)", users)])',
        'langs = ["Python", "TypeScript", "Rust"]',
        'users = [15.7, 4.1, 2.3]',
        'chart = BarChart(langs, [series], "grouped", "Language", "Users (M)")',
        'series = Series("Users (M)", users)',
        'actions = Buttons([btnMore])',
        'btnMore = Button("Tell me more", Action([@ToAssistant("Tell me more about these languages")]), "primary")',
      ].join('\n'),
      form: [
        'root = Card([title, form])',
        'title = TextContent("Plan your trip", "large-heavy")',
        'form = Form("trip-planner", formButtons, [fcType, fcNotes])',
        'formButtons = Buttons([btnSubmit])',
        'btnSubmit = Button("Plan my trip", Action([@ToAssistant("Plan a trip based on my choices")]), "primary")',
        'fcType = FormControl("Trip type", tripType, "What kind of trip?")',
        'tripType = RadioGroup("trip-type", [r1, r2], "relaxed")',
        'r1 = RadioItem("Relaxed", "Slow pace, fewer stops", "relaxed")',
        'r2 = RadioItem("Active", "Packed schedule", "active")',
        'fcNotes = FormControl("Notes", notesInput, "Anything else?")',
        'notesInput = Input("notes", "Add notes")',
      ].join('\n'),
      'stream-partial': [
        'root = Card([title, form])',
        'title = TextContent("Streaming form", "large-heavy")',
        'form = Form("stream-form", formButtons, [fcType])',
        'formButtons = Buttons([btnSubmit])',
        'btnSubmit = Button("Submit", Action([@ToAssistant("Submit the streamed form")]), "primary")',
        'fcType = FormControl("Trip type", tripType, "Pick one")',
        'tripType = RadioGroup("trip-type", [r1], "relaxed")',
        'r1 = RadioItem("Relaxed", "Slow pace", "relaxed")',
      ].join('\n'),
      'stream-full': [
        'root = Card([title, form])',
        'title = TextContent("Streaming form", "large-heavy")',
        'form = Form("stream-form", formButtons, [fcType, fcNotes])',
        'formButtons = Buttons([btnSubmit])',
        'btnSubmit = Button("Submit", Action([@ToAssistant("Submit the streamed form")]), "primary")',
        'fcType = FormControl("Trip type", tripType, "Pick one")',
        'tripType = RadioGroup("trip-type", [r1, r2], "relaxed")',
        'r1 = RadioItem("Relaxed", "Slow pace", "relaxed")',
        'r2 = RadioItem("Active", "Packed schedule", "active")',
        'fcNotes = FormControl("Notes", notesInput, "Anything else?")',
        'notesInput = Input("notes", "Add notes")',
      ].join('\n'),
    }
    for (const [name, program] of Object.entries(fixtures)) {
      const estimate = estimateOpenUIProgram(program)
      expect(estimate.ok, `${name} must stay within budget`).toBe(true)
      expect(
        OPENUI_PROGRAM_BUDGET.maxNodes - estimate.nodes,
        `${name} must keep a comfortable margin`,
      ).toBeGreaterThan(5000)
    }
  })
})