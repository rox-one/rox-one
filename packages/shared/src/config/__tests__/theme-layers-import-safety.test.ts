import { describe, expect, it } from 'bun:test'
import { gradientToCSS, isSafeCssColor, layersToCSSVars, wallpaperToCSS, type ThemeLayers } from '../theme.ts'
import { RoxThemeFileSchema, ThemeLayersSchema } from '../validators.ts'

const SAFE = [
  '#fff', '#ffff', '#38bdf8', '#38bdf880', 'rgb(1, 2, 3)', 'rgba(1,2,3,.5)', 'rgb(1 2 3 / 50%)',
  'hsl(210 40% 50%)', 'hsla(210, 40%, 50%, 0.4)', 'oklch(0.7 0.1 240)', 'oklch(70% 0.1 240deg / 0.5)',
  'oklab(0.5 -0.1 0.1)', 'transparent', 'currentColor', 'black', 'white',
]
const HOSTILE = [
  'red; } body { display: none',
  '#fff;--x:1',
  '#fff}',
  'url(https://evil.example/t.png)',
  'URL(https://evil.example/t.png)',
  'expression(alert(1))',
  'var(--x)',
  'rgb(1,2,3) url(x)',
  'rgb(1,2,3);',
  '#fff\\;',
  '"#fff"',
  "'#fff'",
  'image-set("x.png" 1x)',
  'linear-gradient(red, blue)',
  'color-mix(in oklch, red 10%, url(x))',
  'rgb(calc(1), 2, 3)',
  '#ggg',
  '',
  'a'.repeat(65),
]

describe('isSafeCssColor', () => {
  it('accepts the colour allowlist', () => {
    for (const c of SAFE) expect([c, isSafeCssColor(c)]).toEqual([c, true])
  })
  it('rejects injection payloads and non-colours', () => {
    for (const c of HOSTILE) expect([c, isSafeCssColor(c)]).toEqual([c, false])
    expect(isSafeCssColor(42)).toBe(false)
    expect(isSafeCssColor(undefined)).toBe(false)
  })
})

const file = (layers: unknown) => ({ version: 1, name: 'x', layers })

describe('RoxThemeFileSchema import validation', () => {
  it('accepts a clean theme', () => {
    const ok = RoxThemeFileSchema.safeParse(file({
      frame: { bg: '#111215', gradient: { type: 'linear', angle: 90, stops: [['#000', 0], ['rgba(0,0,0,.4)', 1]] } },
      content: { bg: 'oklch(0.2 0.01 250)', join: 'float', radius: 12 },
      elevation: { 1: '#222', 2: 'hsl(0 0% 20%)' },
      wallpaper: { type: 'radial', at: [10, 20], stops: [['#123', 0], ['#456', 1]] },
      accent: '#38bdf8', glass: 0.5, gridDivider: 'rgba(255,255,255,.09)',
    }))
    expect(ok.success).toBe(true)
  })

  const hostileCases: Array<[string, unknown]> = [
    ['frame.bg', { frame: { bg: 'red; } * { display:none' } }],
    ['frame.fg', { frame: { fg: 'url(https://t.example/p)' } }],
    ['content.border', { content: { border: '#fff}' } }],
    ['elevation', { elevation: { 2: 'expression(alert(1))' } }],
    ['accent (color-mix)', { accent: '#fff 1%, url(x)' }],
    ['gridDivider', { gridDivider: 'var(--evil)' }],
    ['solid wallpaper', { wallpaper: { type: 'solid', color: 'url(x)' } }],
    ['gradient stop', { wallpaper: { type: 'linear', stops: [['#000', 0], ['red);background:url(x', 1]] } }],
    ['frame gradient stop', { frame: { gradient: { type: 'radial', stops: [['#000', 0], ['url(x)', 1]] } } }],
    ['gradient angle NaN-ish string', { wallpaper: { type: 'linear', angle: '45deg;', stops: [['#000', 0], ['#fff', 1]] } }],
    ['stop position out of range', { wallpaper: { type: 'linear', stops: [['#000', -1], ['#fff', 1]] } }],
    ['glass out of range', { glass: 5 }],
    ['radius string', { content: { radius: '10px; x: y' } }],
    ['join not in enum', { content: { join: 'line;}' } }],
    ['unknown key', { frame: { bg: '#000', css: 'x' } }],
  ]
  for (const [label, layers] of hostileCases) {
    it(`rejects hostile ${label}`, () => {
      expect(RoxThemeFileSchema.safeParse(file(layers)).success).toBe(false)
    })
  }
})

describe('layersToCSSVars sanitizes even unvalidated layers', () => {
  it('drops unsafe colours and gradients instead of emitting them', () => {
    const evil = {
      frame: { bg: 'red;} body{display:none', fg: 'url(x)', gradient: { type: 'linear', stops: [['url(x)', 0], ['#000', 1]] } },
      content: { bg: '#fff}', fg: '#eee', border: 'expression(1)', join: 'float', radius: Number.NaN },
      elevation: { 1: 'var(--x)', 2: '#222' },
      wallpaper: { type: 'solid', color: 'url(https://t.example)' },
      accent: '#fff 1%, url(x)',
      gridDivider: '#000;',
      glass: Number.POSITIVE_INFINITY,
    } as unknown as ThemeLayers
    const css = layersToCSSVars(evil).join('\n')
    expect(css).not.toMatch(/url\(|expression|var\(--x\)|display|\}/i)
    expect(css).toContain('--content-fg: #eee;')
    expect(css).toContain('--elev-2: #222;')
    expect(css).toContain('--frame-bg-image: none;')
    expect(css).toContain('--wallpaper: transparent;')
    expect(css).not.toContain('--accent-soft')
    expect(css).not.toContain('--glass-intensity')
    expect(css).toMatch(/--content-radius: \d+px;/)
    for (const line of css.split('\n')) expect(line.match(/;/g)?.length).toBe(1)
  })

  it('keeps safe gradients and wallpapers intact', () => {
    expect(gradientToCSS({ type: 'linear', angle: 90, stops: [['#000', 0], ['#fff', 1]] })).toBe('linear-gradient(90deg, #000 0%, #fff 100%)')
    expect(wallpaperToCSS({ type: 'solid', color: ' #123456 ' })).toBe('#123456')
  })

  it('schema and emitter agree', () => {
    const layers = { accent: 'oklch(0.7 0.1 240)', gridDivider: 'rgb(1 2 3 / 10%)' }
    expect(ThemeLayersSchema.safeParse(layers).success).toBe(true)
    expect(layersToCSSVars(layers as ThemeLayers)).toEqual([
      '--accent-soft: color-mix(in oklch, oklch(0.7 0.1 240) 14%, transparent);',
      '--grid-divider: rgb(1 2 3 / 10%);',
    ])
  })
})
