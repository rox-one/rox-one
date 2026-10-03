/**
 * ANSI escape code parsing utilities for terminal output.
 */

/**
 * ANSI color code to CSS color mapping
 * Supports both foreground (30-37, 90-97) and background (40-47, 100-107) colors
 */
export const ANSI_COLORS: Record<number, string> = {
  // Standard foreground colors (30-37)
  30: '#1a1a1a', // Black
  31: '#ef4444', // Red
  32: '#22c55e', // Green
  33: '#eab308', // Yellow
  34: '#3b82f6', // Blue
  35: '#a855f7', // Magenta
  36: '#06b6d4', // Cyan
  37: '#e4e4e4', // White
  // Bright foreground colors (90-97)
  90: '#666666', // Bright Black (Gray)
  91: '#f87171', // Bright Red
  92: '#4ade80', // Bright Green
  93: '#facc15', // Bright Yellow
  94: '#60a5fa', // Bright Blue
  95: '#c084fc', // Bright Magenta
  96: '#22d3ee', // Bright Cyan
  97: '#ffffff', // Bright White
  // Standard background colors (40-47)
  40: '#1a1a1a', // Black
  41: '#ef4444', // Red
  42: '#22c55e', // Green
  43: '#eab308', // Yellow
  44: '#3b82f6', // Blue
  45: '#a855f7', // Magenta
  46: '#06b6d4', // Cyan
  47: '#e4e4e4', // White
  // Bright background colors (100-107)
  100: '#666666',
  101: '#f87171',
  102: '#4ade80',
  103: '#facc15',
  104: '#60a5fa',
  105: '#c084fc',
  106: '#22d3ee',
  107: '#ffffff',
}

export interface AnsiSpan {
  text: string
  fg?: string
  bg?: string
  bold?: boolean
}

export interface AnsiParseOptions {
  /** Use theme CSS variables so existing output recolors without re-parsing. */
  themeAware?: boolean
}

const ANSI_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const

function paletteColor(index: number, bright: boolean, dim = false): string {
  const fallback = ANSI_COLORS[(bright ? 90 : 30) + index]
  return `var(--terminal-ansi-${dim ? 'dim-' : bright ? 'bright-' : ''}${ANSI_NAMES[index]}, ${fallback})`
}

function indexedColor(index: number): string | undefined {
  if (index < 0 || index > 255) return undefined
  if (index < 16) return paletteColor(index % 8, index >= 8)
  if (index >= 232) {
    const gray = 8 + (index - 232) * 10
    return `rgb(${gray}, ${gray}, ${gray})`
  }
  const cube = index - 16
  const level = (value: number) => value === 0 ? 0 : 55 + value * 40
  return `rgb(${level(Math.floor(cube / 36))}, ${level(Math.floor(cube / 6) % 6)}, ${level(cube % 6)})`
}

/** Theme-aware SGR parsing; fixed-color mode below remains backward compatible. */
function parseThemedAnsi(input: string): AnsiSpan[] {
  const spans: AnsiSpan[] = []
  const pattern = /\x1b\[([0-9;]*)m/g
  let fg: number | string | undefined
  let bg: string | undefined
  let bold = false
  let dim = false
  let lastIndex = 0

  const append = (text: string) => {
    if (!text) return
    let color: string | undefined
    if (typeof fg === 'number') color = paletteColor(fg % 10, fg >= 90 || bold, dim)
    else if (fg) color = fg
    else if (dim) color = 'var(--terminal-dim-foreground, var(--terminal-foreground))'
    else if (bold) color = 'var(--terminal-bright-foreground, var(--terminal-foreground))'
    spans.push({ text, fg: color, bg, bold })
  }

  let match: RegExpExecArray | null
  while ((match = pattern.exec(input)) !== null) {
    append(input.slice(lastIndex, match.index))
    const codes = (match[1] || '').split(';').map(value => Number(value) || 0)
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i]!
      if (code === 0) { fg = undefined; bg = undefined; bold = false; dim = false }
      else if (code === 1) { bold = true; dim = false }
      else if (code === 2) { dim = true; bold = false }
      else if (code === 22) { bold = false; dim = false }
      else if (code === 39) fg = undefined
      else if (code === 49) bg = undefined
      else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) fg = code
      else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
        bg = paletteColor(code % 10, code >= 100)
      } else if (code === 38 || code === 48) {
        // Consume extended colors atomically: their RGB components are not SGRs.
        const mode = codes[++i]
        let color: string | undefined
        if (mode === 5) color = indexedColor(codes[++i] ?? -1)
        else if (mode === 2) {
          const rgb = codes.slice(i + 1, i + 4)
          i += 3
          if (rgb.length === 3 && rgb.every(value => value >= 0 && value <= 255)) {
            color = `rgb(${rgb.join(', ')})`
          }
        }
        if (color) { if (code === 38) fg = color; else bg = color }
      }
    }
    lastIndex = match.index + match[0].length
  }
  append(input.slice(lastIndex))
  return spans
}

/**
 * Parse ANSI escape codes and convert to styled spans
 */
export function parseAnsi(input: string, options: AnsiParseOptions = {}): AnsiSpan[] {
  if (options.themeAware) return parseThemedAnsi(input)
  const result: AnsiSpan[] = []
  // Match ANSI escape sequences: ESC[...m
  const regex = /\x1b\[([0-9;]*)m/g
  let lastIndex = 0
  let currentFg: string | undefined
  let currentBg: string | undefined
  let currentBold = false

  let match
  while ((match = regex.exec(input)) !== null) {
    // Add text before this escape sequence
    if (match.index > lastIndex) {
      const text = input.slice(lastIndex, match.index)
      if (text) {
        result.push({ text, fg: currentFg, bg: currentBg, bold: currentBold })
      }
    }

    // Parse the SGR codes
    const codes = (match[1] || '').split(';').map(c => parseInt(c, 10) || 0)
    for (const code of codes) {
      if (code === 0) {
        // Reset
        currentFg = undefined
        currentBg = undefined
        currentBold = false
      } else if (code === 1) {
        // Bold
        currentBold = true
      } else if (code === 39) {
        // Default foreground
        currentFg = undefined
      } else if (code === 49) {
        // Default background
        currentBg = undefined
      } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
        // Foreground color
        currentFg = ANSI_COLORS[code]
      } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
        // Background color
        currentBg = ANSI_COLORS[code]
      }
    }

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < input.length) {
    const text = input.slice(lastIndex)
    if (text) {
      result.push({ text, fg: currentFg, bg: currentBg, bold: currentBold })
    }
  }

  return result
}

/**
 * Strip ANSI escape codes from text (for copying)
 */
export function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;]*m/g, '')
}

/**
 * Check if output looks like grep content output (with line numbers)
 * Pattern: starts with lines like "123:" (match) or "123-" (context)
 */
export function isGrepContentOutput(output: string): boolean {
  const lines = output.split('\n').slice(0, 5) // Check first 5 lines
  return lines.some(line => /^\d+[:\-]/.test(line))
}

export interface GrepLine {
  lineNum: string
  isMatch: boolean
  content: string
}

/**
 * Parse grep content output into structured lines
 */
export function parseGrepOutput(output: string): GrepLine[] {
  return output.split('\n').map(line => {
    const match = line.match(/^(\d+)([:])(.*)$/)
    const context = line.match(/^(\d+)(-)(.*)$/)
    if (match && match[1] && match[3] !== undefined) {
      return { lineNum: match[1], isMatch: true, content: match[3] }
    } else if (context && context[1] && context[3] !== undefined) {
      return { lineNum: context[1], isMatch: false, content: context[3] }
    }
    return { lineNum: '', isMatch: false, content: line }
  })
}
