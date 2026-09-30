import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Real React component + the application's compiled stylesheet in an isolated
// browser. The creation callback is a test double, not product storage proof.
const root = resolve(import.meta.dir, '../../..')
const session = `rox-quick-task-${process.pid}`
const shots = join(homedir(), 'Pictures/Shots/Agents', session)
let temporary = ''
let server: ViteDevServer | undefined
const evidence: Record<string, unknown> = { level: 'component-browser', productElectron: 'not_run', screenshots: [] }

async function browser(args: string[], script?: string): Promise<any> {
  const child = Bun.spawn({
    cmd: ['agent-browser', '--session', session, '--json', ...args],
    stdin: script === undefined ? 'ignore' : new Blob([script]),
    stdout: 'pipe', stderr: 'pipe',
  })
  const deadline = setTimeout(() => child.kill(), 20_000)
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ])
  clearTimeout(deadline)
  if (code !== 0) throw new Error(`agent-browser ${args[0]}: ${stderr || stdout}`)
  const result = JSON.parse(stdout)
  if (!result.success) throw new Error(JSON.stringify(result))
  return result.data
}

async function evaluate(script: string): Promise<any> {
  const data = await browser(['eval', '--stdin'], script)
  return data.result
}

async function capture(name: string) {
  const path = join(shots, `${name}.png`)
  await browser(['screenshot', path])
  const bytes = await readFile(path)
  ;(evidence.screenshots as unknown[]).push({ name, path, sha256: createHash('sha256').update(bytes).digest('hex') })
}

async function state() {
  return evaluate(`(() => {
    const input = document.querySelector('input');
    const form = input.closest('form');
    const marker = form.querySelector('.rox-home-quick-task-marker');
    const rect = input.getBoundingClientRect();
    const css = getComputedStyle(input);
    return {value: input.value, readOnly: input.readOnly, pending: form.getAttribute('aria-busy'), disabled: input.disabled, invalid: input.getAttribute('aria-invalid'),
      outline: css.outlineStyle, outlineWidth: css.outlineWidth, boxShadow: css.boxShadow,
      font: css.fontFamily, canvas: getComputedStyle(document.documentElement).backgroundColor,
      keyboard: form.dataset.keyboardFocus === 'true',
      marker: getComputedStyle(marker).opacity, background: getComputedStyle(form).backgroundColor,
      shadow: getComputedStyle(form).boxShadow, active: document.activeElement === input,
      width: rect.width, height: rect.height, left: rect.left, right: rect.right,
      created: window.quickTaskProof.created, attempts: window.quickTaskProof.attempts, message: document.querySelector('[aria-live]').textContent};
  })()`)
}

function assertCompactFocus(value: any) {
  expect(value.outline).toBe('none')
  expect(value.boxShadow).toBe('none')
  expect(value.shadow).toContain('inset')
  // The product's selected root font size also scales its rem-based density.
  expect(value.height).toBeGreaterThanOrEqual(24)
  expect(value.height).toBeLessThanOrEqual(32)
}

// This opt-in browser lane needs the installed agent-browser CLI. Plain Bun
// unit runs do not provision browsers or count a skipped lane as visual proof.
describe.skipIf(process.env.ROX_QUICK_TASK_BROWSER !== '1')('Home quick-task browser lane', () => {
beforeAll(async () => {
  temporary = await realpath(await mkdtemp(join(tmpdir(), 'rox-quick-task-browser-')))
  await mkdir(shots, { recursive: true })
  await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir')
  evidence.observedAt = new Date().toISOString()
  evidence.sourceSha256 = Object.fromEntries(await Promise.all([
    'apps/electron/src/renderer/platform/home/QuickTaskInput.tsx',
    'apps/electron/src/renderer/platform/home/quick-task-input.css',
    'apps/electron/src/renderer/platform/home/widgets.tsx',
    'packages/ui/src/styles/index.css',
    'apps/electron/src/renderer/index.css',
  ].map(async path => [path, createHash('sha256').update(await readFile(join(root, path))).digest('hex')])))
  const git = Bun.spawn(['git', '-C', root, 'rev-parse', 'HEAD'], { stdout: 'pipe' })
  evidence.inputRevision = (await new Response(git.stdout).text()).trim()
  await git.exited
  // The app paints its canvas only after ThemeProvider sets data-theme. This
  // fixture must reproduce that hook so dark text is checked on a dark canvas.
  await writeFile(join(temporary, 'index.html'), '<html lang="ru" data-theme="component-fixture"><head><meta charset="UTF-8"/><title>ROX quick task component acceptance</title></head><body><main id="root"></main><script type="module" src="/fixture.tsx"></script></body></html>')
  await writeFile(join(temporary, 'fixture.tsx'), `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import i18n from 'i18next';
    import { I18nextProvider, initReactI18next } from 'react-i18next';
    import ru from ${JSON.stringify(join(root, 'packages/shared/src/i18n/locales/ru.json'))};
    import ${JSON.stringify(join(root, 'apps/electron/src/renderer/index.css'))};
    import { QuickTaskInput } from ${JSON.stringify(join(root, 'apps/electron/src/renderer/platform/home/QuickTaskInput.tsx'))};
    await i18n.use(initReactI18next).init({ lng: 'ru', resources: { ru: { translation: ru } }, keySeparator: false });
    import { PersonalTaskStore } from ${JSON.stringify(join(root, 'packages/core/src/tasks/personal/index.ts'))};
    import { PersonalTaskCreationError } from ${JSON.stringify(join(root, 'apps/electron/src/renderer/lib/personal-tasks-sync.ts'))};
    const taskStore = new PersonalTaskStore();
    window.quickTaskProof = { created: [], attempts: [], fail: false, holdAck: false, releaseAck: null };
    function Fixture() {
      const [disabled, setDisabled] = useState(false);
      window.quickTaskProof.setDisabled = setDisabled;
      return <I18nextProvider i18n={i18n}><section data-shell-role="content" style={{maxWidth:520,width:'100%',padding:16}}>
        <button id="before">До поля</button>
        <QuickTaskInput disabled={disabled} onCreate={async (title, previousAttempt) => {
          const task = previousAttempt ? { ...previousAttempt, title } : taskStore.create({ title, list: 'inbox' });
          window.quickTaskProof.attempts.push(task.id);
          if (window.quickTaskProof.holdAck) await new Promise(resolve => { window.quickTaskProof.releaseAck = resolve; });
          await Promise.resolve();
          if(window.quickTaskProof.fail) throw new PersonalTaskCreationError(task, new Error('controlled async creation failure'));
          window.quickTaskProof.created.push(title);
          return task;
        }}/>
        <button id="after">После поля</button>
      </section></I18nextProvider>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `)
  server = await createServer({
    configFile: false, root: temporary, cacheDir: join(temporary, '.vite'),
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@craft-agent/ui/styles': join(root, 'packages/ui/src/styles/index.css') } },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [temporary, root] } },
  })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('fixture listener has no port')
  await browser(['open', `http://127.0.0.1:${address.port}`])
  await browser(['wait', '--fn', 'Boolean(document.querySelector("input") && window.quickTaskProof)'])
  await evaluate('document.fonts.ready.then(() => true)')
}, 60_000)

afterAll(async () => {
  await browser(['close']).catch(() => undefined)
  await server?.close()
  if (temporary) await rm(temporary, { recursive: true, force: true })
  await writeFile(join(shots, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
}, 30_000)

test('pointer/keyboard cues, stable geometry, IME, error retry and disabled state in the real component', async () => {
  await browser(['click', 'input'])
  const pointer = await state()
  assertCompactFocus(pointer)
  expect(pointer.keyboard).toBe(false)
  expect(pointer.marker).toBe('0')
  await capture('pointer-light')

  await browser(['click', '#before'])
  await browser(['press', 'Tab'])
  const keyboard = await state()
  assertCompactFocus(keyboard)
  expect(keyboard.keyboard).toBe(true)
  expect(keyboard.marker).toBe('1')
  await capture('keyboard-light')
  await browser(['press', 'Tab'])
  expect(await evaluate('document.activeElement.classList.contains("rox-home-quick-task-help")')).toBe(true)
  expect(await evaluate('getComputedStyle(document.querySelector("[role=tooltip]")).visibility')).toBe('visible')
  expect(await evaluate('document.querySelector("[role=tooltip]").textContent')).toContain('Enter')
  await browser(['press', 'Enter'])
  expect(await evaluate('document.activeElement.getAttribute("aria-expanded")')).toBe('true')
  await browser(['press', 'Escape'])
  expect(await evaluate('document.activeElement.getAttribute("aria-expanded")')).toBe('false')
  await browser(['press', 'Tab'])
  expect(await evaluate('document.activeElement.id')).toBe('after')
  await browser(['press', 'Shift+Tab'])
  expect(await evaluate('document.activeElement.classList.contains("rox-home-quick-task-help")')).toBe(true)
  await browser(['press', 'Shift+Tab'])
  expect((await state()).active).toBe(true)
  expect((await state()).marker).toBe('1')

  await browser(['fill', 'input', '  Согласовать макеты  '])
  const populated = await state()
  expect(populated.width).toBeCloseTo(pointer.width, 1)
  expect(populated.left).toBeCloseTo(pointer.left, 1)
  await evaluate(`document.querySelector('input').dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true}))`)
  await browser(['press', 'Enter'])
  expect((await state()).created).toEqual([])
  expect((await state()).value).toBe('  Согласовать макеты  ')
  await evaluate(`document.querySelector('input').dispatchEvent(new CompositionEvent('compositionend', {bubbles:true}));window.quickTaskProof.holdAck=true`)
  await browser(['press', 'Enter'])
  await browser(['wait', '--fn', 'Boolean(window.quickTaskProof.releaseAck)'])
  const pending = await state()
  expect(pending.value).toBe('  Согласовать макеты  ')
  expect(pending.created).toEqual([])
  expect(pending.pending).toBe('true')
  expect(pending.readOnly).toBe(true)
  expect(await evaluate('document.querySelector("button[type=submit]").disabled')).toBe(true)
  // A second Enter and a direct same-form submit cannot create another attempt.
  await browser(['press', 'Enter'])
  await evaluate('document.querySelector("form").requestSubmit()')
  expect((await state()).attempts).toHaveLength(1)
  await capture('pending-native-ack-draft-preserved')
  await evaluate('window.quickTaskProof.holdAck=false;window.quickTaskProof.releaseAck()')
  await browser(['wait', '--fn', 'document.querySelector("input").value === ""'])
  expect((await state()).created).toEqual(['Согласовать макеты'])
  expect((await state()).value).toBe('')
  expect((await state()).active).toBe(true)

  await evaluate('window.quickTaskProof.fail = true')
  await browser(['fill', 'input', 'Повторить после ошибки'])
  await browser(['press', 'Enter'])
  const failed = await state()
  expect(failed.invalid).toBe('true')
  expect(failed.value).toBe('Повторить после ошибки')
  expect(failed.message).toBe('Не удалось добавить задачу. Повторите попытку')
  expect(failed.shadow).not.toBe(populated.shadow)
  expect(await evaluate('Boolean(document.querySelector(".rox-home-quick-task svg.lucide-triangle-alert"))')).toBe(true)
  await capture('error-draft-preserved')
  await evaluate('window.quickTaskProof.fail = false')
  // Verify the rendered button is unobscured before exercising pointer submit.
  expect(await evaluate(`(() => { const b=document.querySelector('button[type="submit"]');const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)) })()`)).toBe(true)
  await browser(['click', 'button[type="submit"]'])
  expect((await state()).created).toEqual(['Согласовать макеты', 'Повторить после ошибки'])
  const attempts = (await state()).attempts
  expect(attempts).toHaveLength(3)
  expect(attempts[2]).toBe(attempts[1])
  expect(attempts[1]).not.toBe(attempts[0])
  expect((await state()).value).toBe('')
  expect((await state()).invalid).toBeNull()
  expect((await state()).active).toBe(true)

  await evaluate('window.quickTaskProof.setDisabled(true)')
  await browser(['wait', '--fn', 'document.querySelector("input").disabled'])
  expect((await state()).disabled).toBe(true)
  await browser(['click', '#before'])
  await browser(['press', 'Tab'])
  expect(await evaluate('document.activeElement.id')).toBe('after')
  await capture('disabled')
  await evaluate('window.quickTaskProof.setDisabled(false)')
  await browser(['wait', '--fn', '!document.querySelector("input").disabled'])

  for (const variant of ['dark', 'zen', 'high-contrast']) {
    await evaluate(`document.documentElement.classList.toggle('dark', ${variant === 'dark'}); document.documentElement.dataset.shellStyle = ${JSON.stringify(variant === 'zen' ? 'zen' : 'default')}; document.documentElement.dataset.contrast = ${JSON.stringify(variant === 'high-contrast' ? 'high' : 'default')}`)
    await browser(['click', '#before'])
    await browser(['press', 'Tab'])
    const value = await state()
    assertCompactFocus(value)
    expect(value.marker).toBe('1')
    expect(value.font).toBe(pointer.font)
    if (variant === 'dark') expect(value.canvas).not.toBe(pointer.canvas)
    await capture(`keyboard-${variant}`)
  }
  await browser(['set', 'viewport', '390', '600'])
  await evaluate('document.documentElement.style.zoom="2"')
  const zoomed = await state()
  expect(zoomed.right).toBeLessThanOrEqual(390)
  expect(zoomed.width).toBeGreaterThan(0)
  await capture('narrow-200-percent')
  await browser(['set', 'media', 'light', 'reduced-motion'])
  expect(await evaluate('getComputedStyle(document.querySelector("button[type=submit]")).transitionDuration')).toBe('0s')

  // Negative control: the same computed-style oracle rejects a returned thick
  // outline, including an override that could escape the local selector.
  await evaluate(`const s=document.createElement('style');s.id='broken-focus';s.textContent='.rox-home-quick-task-input:focus { outline: 5px solid purple !important }';document.head.append(s)`)
  const broken = await state()
  expect(broken.outlineWidth).toBe('5px')
  expect(() => assertCompactFocus(broken)).toThrow()
  await evaluate('document.getElementById("broken-focus").remove();document.documentElement.style.zoom=""')
  evidence.observed = { pointer, keyboard, failed, zoomed, negativeControl: 'rejected 5px external outline' }
}, 90_000)
})
