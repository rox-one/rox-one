import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { build } from 'esbuild'
import { chromium, type Browser } from '@playwright/test'

const enabled = process.env.ROX_RUNTIME_MAP_BROWSER_TEST === '1'
const repoRoot = join(import.meta.dir, '../../../../../../..')
let server: Server | undefined
let browser: Browser | undefined
let base: string

describe.skipIf(!enabled)('mounted map lazy-load recovery', () => {
  beforeAll(async () => {
    const result = await build({ stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { createInstance } from 'i18next';
      import { I18nextProvider } from 'react-i18next';
      import { ChatRuntimeSplit, createRetryableRuntimeMapLazy } from './apps/electron/src/renderer/components/runtime-map/ChatRuntimeSplit';
      const i18n=createInstance();
      await i18n.init({lng:'en',resources:{en:{translation:{runtimeMap:{retry:'Retry',renderError:'Map failed',resize:'Resize'}}}}});
      let chatMounts=0, loads=0;
      const Map=createRetryableRuntimeMapLazy(async()=>{
        if(++loads===1) throw new Error('Isolated chunk transport failure');
        return {default:()=>React.createElement('output',{'data-testid':'map-ready'},'Recovered map')};
      });
      function Chat(){
        const [draft,setDraft]=React.useState('');
        React.useEffect(()=>{chatMounts++},[]);
        return React.createElement('input',{'data-testid':'chat-draft',value:draft,onChange:e=>setDraft(e.target.value)});
      }
      function Harness(){
        const [open,setOpen]=React.useState(false);
        return React.createElement(React.Fragment,null,
          React.createElement('button',{'data-testid':'open-map',onClick:()=>setOpen(true)},'Open'),
          React.createElement(ChatRuntimeSplit,{scopeKey:'lazy-test',open,chat:React.createElement(Chat),map:React.createElement(React.Suspense,{fallback:'Loading'},React.createElement(Map))}));
      }
      window.mapRetryDiagnostics=()=>({chatMounts,loads});
      createRoot(document.getElementById('root')).render(React.createElement(I18nextProvider,{i18n},React.createElement(Harness)));
    `, loader: 'tsx', resolveDir: repoRoot }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', loader: { '.css': 'empty' }, tsconfig: join(repoRoot, 'apps/electron/tsconfig.json') })
    const javascript = result.outputFiles[0]!.text
    server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': request.url === '/fixture.js' ? 'text/javascript' : 'text/html' })
      response.end(request.url === '/fixture.js' ? javascript : '<!doctype html><div id="root"></div><script type="module" src="/fixture.js"></script>')
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    browser = await chromium.launch({ headless: true })
  }, 30_000)
  afterAll(async () => {
    await browser?.close()
    server?.closeAllConnections()
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
  })
  it('a failed chunk can retry without remounting chat or losing its draft', async () => {
    const page = await browser!.newPage()
    try {
      await page.goto(base)
      await page.getByTestId('chat-draft').fill('Draft survives retry')
      await page.getByTestId('open-map').click()
      await page.getByRole('alert').waitFor()
      expect(await page.getByTestId('chat-draft').inputValue()).toBe('Draft survives retry')
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
      await page.getByTestId('map-ready').waitFor()
      expect(await page.getByTestId('map-ready').textContent()).toBe('Recovered map')
      expect(await page.getByTestId('chat-draft').inputValue()).toBe('Draft survives retry')
      expect(await page.evaluate(() => (window as unknown as { mapRetryDiagnostics: () => { chatMounts: number; loads: number } }).mapRetryDiagnostics())).toEqual({ chatMounts: 1, loads: 2 })
    } finally { await page.close() }
  }, 30_000)
})
