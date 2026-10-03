import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const outputRoot = process.env.HOST_BASH_PROOF_ROOT ?? '/tmp/rox-branch-integration-20261003';
const bun = process.env.BUN_EXECUTABLE ?? join(outputRoot, 'bun-1.3.14/bun-darwin-aarch64/bun');
const node = process.execPath;
const quote = value => `'${value.replace(/'/g, `'"'"'`)}'`;
async function probe(checkout, kind) {
  const root = mkdtempSync(join(tmpdir(), `host-negative-${kind}-`));
  const startup = join(root, 'startup');
  writeFileSync(startup, 'export AWS_SECRET_ACCESS_KEY=private-startup-canary\n');
  const pidfile = join(root, 'owned-child.pid');
  const code = `const fs=require('fs'),cp=require('child_process');const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore',1,2]});fs.writeFileSync(${JSON.stringify(pidfile)},String(child.pid));child.unref();console.log('before-root-exit');`;
  const command = kind === 'startup' ? 'printf "credential:%s" "$AWS_SECRET_ACCESS_KEY"' : `${quote(node)} -e ${quote(code)}`;
  const start = performance.now();
  let killedOwned = false;
  let child;
  try {
    const result = await new Promise(resolve => {
      child = spawn(bun, [fileURLToPath(new URL('./negative.fixture.ts', import.meta.url))], {
        env: { ...process.env, HOME: root, BASH_ENV: startup, HOST_BASH_MODULE: `${checkout}/packages/session-tools-core/src/handlers/host-bash.ts`,
          HOST_BASH_PROBE_ROOT: root, HOST_BASH_PROBE_COMMAND: command }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '', finished = false;
      const finish = value => { if (finished) return; finished = true; clearTimeout(timer); resolve(value); };
      const timer = setTimeout(() => { child.kill('SIGKILL'); child.stdout.destroy(); child.stderr.destroy(); finish({ watchdog: true, stdout, stderr }); }, 6500);
      child.stdout.on('data', data => { stdout += data.toString(); }); child.stderr.on('data', data => { stderr += data.toString(); });
      child.once('error', error => finish({ error: String(error), stdout, stderr }));
      child.once('close', exitCode => finish({ exitCode, stdout, stderr }));
    });
    const elapsedMs = Math.round(performance.now() - start);
    const leaked = result.stdout.includes('private-startup-canary');
    const pidRecorded = existsSync(pidfile);
    const accepted = kind === 'startup' ? !leaked && result.exitCode === 0 : result.exitCode === 0 && result.stdout.includes('timedOut: true') && result.stdout.includes('before-root-exit') && pidRecorded && elapsedMs < 6000;
    return { checkout, kind, accepted, elapsedMs, leaked, pidRecorded, ...result };
  } finally {
    if (existsSync(pidfile)) { const pid = Number(readFileSync(pidfile, 'utf8')); try { process.kill(pid, 'SIGKILL'); killedOwned = true; } catch {} }
    if (child && child.exitCode === null) child.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
}
const before = process.env.HOST_BASH_BASELINE_CHECKOUT ?? `${outputRoot}/host-bash-negative-worktree`;
const after = process.env.HOST_BASH_CANDIDATE_CHECKOUT ?? process.cwd();
const results = await Promise.all([probe(before,'startup'), probe(before,'pipes'), probe(after,'startup'), probe(after,'pipes')]);
writeFileSync(join(outputRoot,'host-bash-negative-results.json'), JSON.stringify({ baseline: '6a2020fcc31d07b84208d56073a9c469caaefb9a', results }, null, 2)+'\n');
for (const result of results) console.log(JSON.stringify({ checkout: result.checkout, kind: result.kind, accepted: result.accepted, elapsedMs: result.elapsedMs, leaked: result.leaked, watchdog: result.watchdog, exitCode: result.exitCode }));
if (!results[0].leaked || results[1].watchdog !== true || results[1].pidRecorded !== true || results[0].accepted || results[1].accepted || !results[2].accepted || !results[3].accepted) process.exitCode=1;
