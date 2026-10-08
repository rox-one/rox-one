import { expect, test } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runNativeBrowserProcess } from '../../adapters/work/meetings-automations/native-browser-process'

test('file-dialog deadline stops its detached child and grandchild while preserving an unrelated sibling', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'file-dialog-node-custody-'))
  const pidFile = join(directory, 'owned-pids.json')
  const helper = pathToFileURL(resolve(import.meta.dir, '../../../../../../../../scripts/product-tour/browser-node-process.mjs')).href
  const sibling = spawn('node', ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  let owned: { child: number; grandchild: number } | undefined
  const live = (pid: number) => {
    if (process.platform === 'win32') { try { process.kill(pid, 0); return true } catch { return false } }
    const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim()
    return state !== '' && !state.startsWith('Z')
  }
  try {
    const detached = `const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');
      const grandchild=spawn(process.execPath,['-e','setInterval(() => {},1000)'],{detached:true,stdio:'ignore'});
      writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({child:process.pid,grandchild:grandchild.pid}));setInterval(() => {},1000);`
    const program = `import {spawn} from 'node:child_process';import {bindOwnedBrowserTermination} from ${JSON.stringify(helper)};
      const child=spawn(process.execPath,['-e',${JSON.stringify(detached)}],{detached:true,stdio:'ignore'});
      const custody=bindOwnedBrowserTermination(child);
      child.once('exit',async()=>{await custody.terminate();custody.dispose();process.exit(137)});
      console.error('file-dialog owned child entered');`
    const started = Date.now()
    let failure: unknown
    try { await runNativeBrowserProcess(['node', '--input-type=module', '-e', program], { label: 'detached file-dialog custody', deadlineMs: 500 }) }
    catch (error) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).toContain('timed out')
    expect(String(failure)).toContain('file-dialog owned child entered')
    expect(Date.now() - started).toBeLessThan(2_000)
    owned = JSON.parse(readFileSync(pidFile, 'utf8'))
    expect({ childLive: live(owned!.child), grandchildLive: live(owned!.grandchild), siblingLive: live(sibling.pid!) })
      .toEqual({ childLive: false, grandchildLive: false, siblingLive: true })
  } finally {
    sibling.kill('SIGKILL')
    if (!owned) { try { owned = JSON.parse(readFileSync(pidFile, 'utf8')) } catch { /* A failed start has no descendants. */ } }
    for (const pid of owned ? [owned.child, owned.grandchild] : []) { try { process.kill(pid, 'SIGKILL') } catch { /* Already stopped. */ } }
    rmSync(directory, { recursive: true, force: true })
  }
}, 5_000)
