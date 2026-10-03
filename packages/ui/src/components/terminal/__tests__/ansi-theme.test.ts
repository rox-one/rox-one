import { describe, expect, it } from 'bun:test'
import { ANSI_COLORS, parseAnsi, stripAnsi } from '../ansi-parser'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TerminalOutput } from '../TerminalOutput'

const esc = '\x1b['
const themed = (text: string) => parseAnsi(text, { themeAware: true })

describe('terminal theme palette', () => {
  it('preserves the fixed-color parser contract for existing callers', () => {
    expect(parseAnsi(`${esc}31mred${esc}0m plain`)).toEqual([
      { text: 'red', fg: ANSI_COLORS[31], bg: undefined, bold: false },
      { text: ' plain', fg: undefined, bg: undefined, bold: false },
    ])
  })

  it('uses CSS variables for all eight normal, bright and dim foregrounds and backgrounds', () => {
    const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
    names.forEach((name, index) => {
      expect(themed(`${esc}${30 + index}mx`)[0]!.fg).toContain(`--terminal-ansi-${name},`)
      expect(themed(`${esc}${90 + index}mx`)[0]!.fg).toContain(`--terminal-ansi-bright-${name},`)
      expect(themed(`${esc}2;${30 + index}mx`)[0]!.fg).toContain(`--terminal-ansi-dim-${name},`)
      expect(themed(`${esc}${40 + index}mx`)[0]!.bg).toContain(`--terminal-ansi-${name},`)
      expect(themed(`${esc}${100 + index}mx`)[0]!.bg).toContain(`--terminal-ansi-bright-${name},`)
    })
  })

  it('resets bold/dim and foreground/background independently without changing transcript', () => {
    const output = `${esc}1;31;44mA${esc}22mB${esc}39mC${esc}49mD${esc}2mE${esc}0mF`
    const spans = themed(output)
    expect(spans[0]!.fg).toContain('--terminal-ansi-bright-red,')
    expect(spans[1]!.fg).toContain('--terminal-ansi-red,')
    expect(spans[1]!.bold).toBe(false)
    expect(spans[2]!.fg).toBeUndefined()
    expect(spans[2]!.bg).toContain('--terminal-ansi-blue,')
    expect(spans[3]!.bg).toBeUndefined()
    expect(spans[4]!.fg).toContain('--terminal-dim-foreground,')
    expect(spans[5]!.fg).toBeUndefined()
    expect(spans.map(span => span.text).join('')).toBe('ABCDEF')
    expect(stripAnsi(output)).toBe('ABCDEF')
    expect(themed('next command')[0]!.fg).toBeUndefined()
  })

  it('consumes truecolor and indexed color components atomically', () => {
    const spans = themed(`${esc}38;2;255;0;1mRGB${esc}48;5;196mBG${esc}0mreset`)
    expect(spans[0]!.fg).toBe('rgb(255, 0, 1)')
    expect(spans[0]!.bold).toBe(false)
    expect(spans[1]!.fg).toBe('rgb(255, 0, 1)')
    expect(spans[1]!.bg).toBe('rgb(255, 0, 0)')
    expect(spans[2]!.fg).toBeUndefined()
    expect(themed(`${esc}38;5;244mgray`)[0]!.fg).toBe('rgb(128, 128, 128)')
  })

  it('keeps rendered spans independent of the selected palette so CSS can recolor existing output', () => {
    const spans = themed(`${esc}31mexisting log`)
    expect(spans[0]!.fg).toBe('var(--terminal-ansi-red, #ef4444)')
    expect(JSON.stringify(spans)).not.toContain('#bf616a')
    expect(stripAnsi(`${esc}31mexisting log`)).toBe('existing log')
  })

  it('renders real terminal output with palette spans and no escape sequences', () => {
    const html = renderToStaticMarkup(createElement(TerminalOutput, {
      command: 'print colors',
      output: `${esc}31mred${esc}0m plain`,
      theme: 'dark',
    }))
    expect(html).toContain('background-color:var(--terminal-background)')
    expect(html).toContain('color:var(--terminal-ansi-red, #ef4444)')
    expect(html).toContain('red</span>')
    expect(html).toContain(' plain')
    expect(html).not.toContain('\x1b')
  })
})
