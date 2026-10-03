import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const root=process.cwd(), profile=resolve('work/rox-readiness-ui-001.chrome-review-deep-5a0');
mkdirSync(profile,{recursive:true});
const executable='/Users/t/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const chrome=spawn(executable,['--headless=new','--disable-gpu','--disable-background-networking','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{detached:true,stdio:'ignore'});
let browser, context;
const server=createServer((request,response)=>{response.writeHead(200,{'content-type':request.url==='/fixture.js'?'text/javascript':'text/html'});response.end(request.url==='/fixture.js'?readFileSync('work/rox-readiness-ui-001.navigation-fixture-5a0.js'):'<!doctype html><div id="root"></div><script src="/fixture.js"></script>')});
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const deadline=Date.now()+20000;while(!existsSync(profile+'/DevToolsActivePort')) {if(Date.now()>deadline)throw new Error('Owned Chrome startup timeout');await new Promise(resolve=>setTimeout(resolve,100))}
  const port=readFileSync(profile+'/DevToolsActivePort','utf8').split('\n')[0];browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:10000});
  context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(5000);
  await page.goto('http://127.0.0.1:'+server.address().port+'/?ws=a&route=home');await page.waitForFunction(()=>document.querySelector('output')?.getAttribute('data-route')==='home');
  await page.evaluate(()=>{window.ui001RetainedDeep=[];const original=window.electronAPI.onDeepLinkNavigate;window.electronAPI.onDeepLinkNavigate=callback=>{window.ui001RetainedDeep.push(callback);return original(callback)}});
  await page.evaluate(()=>window.ui001nav.workspace('ws-b','b'));await page.waitForFunction(()=>document.querySelector('output')?.getAttribute('data-workspace')==='ws-b'&&document.querySelector('output')?.getAttribute('data-route')==='allSessions/session/first-b');
  await page.evaluate(()=>window.ui001nav.workspace('ws-a','a'));await page.waitForFunction(()=>document.querySelector('output')?.getAttribute('data-workspace')==='ws-a'&&document.querySelector('output')?.getAttribute('data-route')==='home');
  const before=await page.evaluate(()=>({snapshot:window.ui001nav.snapshot(),retainedListeners:window.ui001RetainedDeep.length,creations:window.ui001nav.creations()}));
  await page.evaluate(()=>{window.ui001nav.holdActionTimers();window.ui001RetainedDeep[0]({action:'new-session',actionParams:{input:'STALE-WORKSPACE-B',send:'true'}})});
  await page.waitForFunction(()=>window.ui001nav.creations().length===1);
  const afterOldCallback=await page.evaluate(()=>({snapshot:window.ui001nav.snapshot(),creations:window.ui001nav.creations()}));
  await page.evaluate(()=>window.ui001nav.resolveCreate(0,'stale-b-session'));
  await page.waitForFunction(()=>window.ui001nav.timers()===1);
  await page.evaluate(()=>window.ui001nav.fireActionTimers());
  const afterReply=await page.evaluate(()=>({snapshot:window.ui001nav.snapshot(),actions:window.ui001nav.actionCalls()}));
  const result={sourceRevision:'5a0b769b894aed2ed09ba8bcbe01a41cf8149d76',fixture:'unchanged navigation fixture and actual production NavigationProvider; explicit mocked IPC',before,afterOldCallback,afterReply};
  writeFileSync('work/rox-readiness-ui-001.stale-deep-link-probe-5a0.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
} finally {
  await context?.close();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  const command=execFileSync('ps',['-p',String(chrome.pid),'-o','command='],{encoding:'utf8'});if(command.includes(profile))process.kill(-chrome.pid,'SIGKILL');
}
