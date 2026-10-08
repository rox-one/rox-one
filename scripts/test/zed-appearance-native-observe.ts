/** Read-only CSS/material receipt for an already launched disposable Electron UI.
 * All native clicks/typing remain in the supported computer-use surface.
 * ROX_APPEARANCE_TEST_WORKSPACE must match the target window; content is hashed,
 * never copied into the receipt. No cookies, credentials or network traces.
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const workspace = process.env.ROX_APPEARANCE_TEST_WORKSPACE
if (!workspace) throw new Error('Specify the disposable test workspace ID')
const name = process.argv[2] ?? 'snapshot'
if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid receipt name')
const directory = process.env.ROX_APPEARANCE_TEST_ARTIFACTS ?? '/tmp/rox-appearance-native-receipts'
const browser = await chromium.connectOverCDP(process.env.ROX_APPEARANCE_TEST_CDP ?? 'http://127.0.0.1:9228')
try {
  const page = browser.contexts().flatMap(context => context.pages()).find(page => new URL(page.url()).searchParams.get('workspaceId') === workspace)
  if (!page) throw new Error('The specified disposable workspace window is unavailable')
  const result = await page.evaluate(async () => {
    const root = document.documentElement
    const api = (window as any).electronAPI
    if (api?.getRuntimeEnvironment?.() !== 'electron') throw new Error('Native runtime required')
    const selectors = ['.chrome-topbar','.chrome-rail','.chrome-strip','[data-inspector-panel]','[data-shell-role="content"]','[data-terminal-panel]','.rox-inspector-terminal','.input-container','.ProseMirror','pre','[role="separator"]']
    const surfaces = selectors.flatMap(selector => Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(element => element.getBoundingClientRect().width > 0).map(element => {
      const s = getComputedStyle(element), b = element.getBoundingClientRect()
      return { selector, role: element.dataset.panelRole, background: s.backgroundColor, color: s.color, radius: s.borderRadius, blur: s.backdropFilter, shadow: s.boxShadow, border: [s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth], opacity:s.opacity, font: s.fontFamily, bounds:{x:b.x,y:b.y,width:b.width,height:b.height} }
    }))
    return { timestamp: new Date().toISOString(), route: new URL(location.href).searchParams.get('route'), theme: root.dataset.theme, mode: root.classList.contains('dark')?'dark':'light', shell: await api.getShellSnapshot(), datasets:{...root.dataset}, surfaces,
      code: Array.from(document.querySelectorAll('pre')).map(element => ({ content: element.textContent ?? '', colors: Array.from(element.querySelectorAll('span[style]')).map(span=>getComputedStyle(span).color) })),
      terminal: Array.from(document.querySelectorAll('.rox-inspector-terminal')).map(element=>({content:element.textContent??'',colors:Array.from(element.querySelectorAll('span[style]')).map(span=>getComputedStyle(span).color)})) }
  })
  const hash = (value:string) => createHash('sha256').update(value).digest('hex')
  const receipt = { ...result, code:result.code.map(({content,...rest})=>({...rest,sha256:hash(content),length:content.length})), terminal:result.terminal.map(({content,...rest})=>({...rest,sha256:hash(content),length:content.length})) }
  await mkdir(directory,{recursive:true})
  const path=resolve(directory,`${name}.json`)
  await writeFile(path,JSON.stringify(receipt,null,2)+'\n')
  console.log(JSON.stringify({path,theme:receipt.theme,mode:receipt.mode,shell:receipt.shell,surfaces:receipt.surfaces.length}))
} finally { await browser.close() }
