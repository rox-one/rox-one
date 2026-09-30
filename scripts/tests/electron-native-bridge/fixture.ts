import { app, BrowserWindow, ipcMain } from 'electron';
import { realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { IpcMainEvent } from 'electron';
import type { HandlerDeps } from '../../../packages/server-core/src/handlers/handler-deps.ts';
import type { StoredCredential } from '../../../packages/shared/src/credentials/types.ts';
import type { NativeDataEntitySnapshot, NoteDocument } from '../../../packages/shared/src/protocol/dto.ts';
import type { NativeReplicaQueuedMutation } from '../../../packages/shared/src/protocol/native-replica.ts';
import { DatabaseSync } from 'node:sqlite';
import { NativeAuthority } from '../../../packages/server-core/src/authority/native-authority.ts';
import { NativeJournal } from '../../../packages/server-core/src/authority/native-journal.ts';
import { CollaborationSyncService } from '../../../packages/server-core/src/collaboration/sync-service.ts';
import { WsRpcServer } from '../../../packages/server-core/src/transport/server.ts';
import { registerNativeDataHandlers } from '../../../packages/server-core/src/handlers/rpc/native-data.ts';
import { registerNotesHandlers } from '../../../packages/server-core/src/handlers/rpc/notes.ts';
import { registerNativeReplicaIpc } from '../../../apps/electron/src/main/native-replica.ts';
import { createLocalClientBindingRegistry } from '../../../apps/electron/src/main/local-client-binding.ts';
/** Task-only main composition and synthetic credential DI, not product main/OS custody. */
interface SavedFixture {
    admin: ReturnType<NativeAuthority['bootstrapLocalAdministrator']>;
    issued: NonNullable<ReturnType<NativeAuthority['redeemEnrollment']>>;
    ws: ReturnType<NativeAuthority['registerWorkspace']>;
    stored: Array<[
        string,
        StoredCredential
    ]>;
    operationId: string;
}
interface BridgeResults {
    snapshot: NativeDataEntitySnapshot;
    note?: NoteDocument;
    pending?: NativeReplicaQueuedMutation[];
    pendingBefore?: number;
    pendingAfter?: number;
    ack?: boolean;
    operationId?: string;
}
function canonicalFile(snapshot: NativeDataEntitySnapshot) {
    assert.equal(snapshot.files.length, 1);
    const file = snapshot.files[0];
    assert(file);
    return file;
}
function ownedEnv(name: string): string { const value = process.env[name]; assert(value, name + ' is required; launch via run.ts'); return value; }
const archive = ownedEnv('ROX_BRIDGE_ARCHIVE');
const root = ownedEnv('ROX_BRIDGE_ROOT');
const runId = ownedEnv('ROX_BRIDGE_RUN_ID');
assert.equal(realpathSync(root), root);
assert.equal(readFileSync(join(root, 'owned-run-id'), 'utf8'), runId);
const phase = ownedEnv('ROX_BRIDGE_PHASE');
assert(['single', 'prepare', 'replay'].includes(phase));
const config = join(root, 'config');
mkdirSync(config, { recursive: true });
mkdirSync(join(root, 'workspace'), { recursive: true });
app.setPath('userData', join(root, 'profile'));
app.setPath('sessionData', join(root, 'profile'));
if (process.platform === 'darwin')
    app.setActivationPolicy('prohibited');
let other: BrowserWindow | undefined;
let win: BrowserWindow | undefined, server: WsRpcServer | undefined, authority: NativeAuthority | undefined, journal: NativeJournal | undefined, dispose: (() => void) | undefined;
let cleaned = false;
function cleanup() { if (cleaned)
    return; cleaned = true; clearTimeout(deadline); try {
    win?.destroy();
}
catch { } ; try {
    other?.destroy();
}
catch { } ; try {
    dispose?.();
}
catch { } ; try {
    server?.close();
}
catch { } ; try {
    journal?.close();
}
catch { } ; try {
    authority?.close();
}
catch { } ; if (phase === 'single')
    try {
        rmSync(root, { recursive: true, force: true });
    }
    catch { } }
const deadline = setTimeout(() => { writeFileSync(join(archive, 'result.json'), JSON.stringify({ status: 'failed', phase: 'timeout' })); cleanup(); app.exit(2); }, 40000);
app.on('will-quit', cleanup);
app.whenReady().then(async () => {
    authority = new NativeAuthority({ stateDir: join(root, 'state') });
    const saved = phase === 'replay' ? JSON.parse(readFileSync(join(root, 'synthetic-private.json'), 'utf8')) as SavedFixture : null;
    const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    let admin;
    try {
        Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
        admin = saved?.admin ?? authority.bootstrapLocalAdministrator('owned synthetic operator');
    }
    finally {
        if (tty)
            Object.defineProperty(process.stdin, 'isTTY', tty);
        else
            Reflect.deleteProperty(process.stdin, 'isTTY');
    }
    const ws = saved?.ws ?? authority.registerWorkspace(admin.credential, 'workspace-a', join(root, 'workspace'));
    const issued = saved?.issued ?? authority.redeemEnrollment(authority.issueEnrollment(admin.credential, 'owned synthetic', Date.now() + 60000), 'owned synthetic')!;
    if (!saved)
        authority.grantWorkspace(admin.credential, issued.principal.subject, ws.id, ['read', 'write', 'delete']);
    journal = new NativeJournal({ stateDir: join(root, 'state'), authorize: (p, w, a, r) => authority!.authorize(p, w, a, r), permissionFence: (p, w, a) => authority!.permissionFence(p, w, a), authorizePreparedRecovery: (p, w, a, f, r) => authority!.authorizePreparedRecovery(p, w, a, f, r) });
    const bindings = createLocalClientBindingRegistry();
    const find = (id: number) => { const owner = [win, other].find(w => w && !w.isDestroyed() && w.webContents.id === id); return owner ? { webContentsId: id, renderer: owner.webContents, workspaceId: ws.id } : null; };
    server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: authority, resolveLocalClientBinding: c => bindings.resolve(c, find) });
    const deps = { nativeData: { authority, journal, sync: new CollaborationSyncService(authority, journal) } } as HandlerDeps;
    registerNativeDataHandlers(server, deps);
    registerNotesHandlers(server, deps);
    await server.listen();
    const stored = new Map<string, StoredCredential>(saved?.stored ?? []);
    dispose = registerNativeReplicaIpc(ipcMain, { configDir: config, credentials: { get: async (id) => stored.get(JSON.stringify(id)) ?? null, set: async (id, value) => { stored.set(JSON.stringify(id), value); } }, getWorkspaceForWindow: id => find(id)?.workspaceId ?? null });
    const sync = { '__get-web-contents-id': (e: IpcMainEvent) => e.sender.id, '__get-ws-port': () => server!.port, '__get-workspace-id': () => ws.id, '__get-local-client-proof': (e: IpcMainEvent) => bindings.issue(e.sender), '__get-workspace-remote-config': () => null };
    for (const [name, fn] of Object.entries(sync))
        ipcMain.on(name, e => { e.returnValue = fn(e); });
    ipcMain.handle('__resolve-local-ws-token', async (e) => { assert(find(e.sender.id)); return issued.credential; });
    const preload = ownedEnv('ROX_BRIDGE_PRELOAD');
    win = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false } });
    win.webContents.on('preload-error', (_event, _path, error) => writeFileSync(join(archive, 'preload-error.txt'), String(error)));
    win.webContents.setAudioMuted(true);
    writeFileSync(join(root, 'fixture.html'), `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ws://127.0.0.1:*;"><body>owned composition fixture</body>`);
    await win.loadFile(join(root, 'fixture.html'));
    let results: BridgeResults;
    if (phase === 'replay') {
        assert(saved);
        results = await win.webContents.executeJavaScript(`(async()=>{const a=window.electronAPI,h=await a.nativeReplica.open(${JSON.stringify(ws.id)});const pending=await a.nativeReplica.pending(h);if(pending.length!==1)throw Error('restart lost pending queue');const q=pending[0];const receipt=await a.nativeData.mutate({workspaceId:${JSON.stringify(ws.id)},kind:'notes',...q});const ack=await a.nativeReplica.acknowledge(h,receipt);const snapshot=await a.nativeData.readEntity({workspaceId:${JSON.stringify(ws.id)},kind:'notes',nativeId:q.nativeId});const remaining=await a.nativeReplica.pending(h);await a.nativeReplica.close(h);return {pendingBefore:pending.length,pendingAfter:remaining.length,ack,snapshot,operationId:q.operationId}})()`);
        assert.equal(results.pendingBefore, 1);
        assert.equal(results.pendingAfter, 0);
        assert.equal(results.ack, true);
        assert.equal(results.snapshot.revision, 2);
        assert.equal(results.operationId, saved.operationId);
        assert.equal(readFileSync(join(root, 'workspace', canonicalFile(results.snapshot).path), 'utf8'), '# Owned pending restart\n');
    }
    else {
        results = await win.webContents.executeJavaScript(`(async()=>{const a=window.electronAPI; if(!a)throw Error('production preload absent'); const note=await a.createNote(${JSON.stringify(ws.id)},'Synthetic bridge note');const snapshot=await a.nativeData.readEntity({workspaceId:${JSON.stringify(ws.id)},kind:'notes',nativeId:note.id});const h=await a.nativeReplica.open(${JSON.stringify(ws.id)});const pending=await a.nativeReplica.pending(h);await a.nativeReplica.close(h);return {note,snapshot,pending}})()`);
        assert.equal(results.snapshot.revision, 1);
        assert(results.pending);
        assert(results.note);
        assert.equal(results.pending.length, 0);
        assert.equal(readFileSync(join(root, 'workspace', canonicalFile(results.snapshot).path), 'utf8'), results.note.content);
        if (phase === 'prepare') {
            assert(results.note);
            const noteId = results.note.id;
            const queued: NativeReplicaQueuedMutation = await win.webContents.executeJavaScript(`(async()=>{const a=window.electronAPI,h=await a.nativeReplica.open(${JSON.stringify(ws.id)});await a.nativeData.readEntity({workspaceId:${JSON.stringify(ws.id)},kind:'notes',nativeId:${JSON.stringify(noteId)}});const q=await a.nativeReplica.enqueue(h,{nativeId:${JSON.stringify(noteId)},expectedRevision:1,schemaVersion:1,changes:[{path:${JSON.stringify(canonicalFile(results.snapshot).path)},content:'# Owned pending restart\\n'}]});return q})()`);
            writeFileSync(join(root, 'synthetic-private.json'), JSON.stringify({ admin, issued, ws, stored: [...stored], operationId: queued.operationId }), { mode: 0o600 });
            writeFileSync(join(archive, 'restart-prepared.json'), JSON.stringify({ pid: process.pid, pending: 1, canonicalRevision: 1, operationHash: createHash('sha256').update(queued.operationId).digest('hex') }));
            cleanup();
            app.quit();
            return;
        }
    }
    const countReceipts = () => { const db = new DatabaseSync(join(root, 'state', 'native-journal.sqlite'), { readOnly: true }); try {
        return Number((db.prepare('SELECT COUNT(*) AS n FROM receipts').get() as {
            n: number;
        }).n);
    }
    finally {
        db.close();
    } };
    const receiptsBefore = countReceipts();
    const current = results.snapshot;
    const safety = await win.webContents.executeJavaScript(`(async()=>{const a=window.electronAPI,h=await a.nativeReplica.open(${JSON.stringify(ws.id)});await a.nativeData.readEntity({workspaceId:${JSON.stringify(ws.id)},kind:'notes',nativeId:${JSON.stringify(current.nativeId)}});const mutation={nativeId:${JSON.stringify(current.nativeId)},expectedRevision:${current.revision},schemaVersion:1,changes:[{path:${JSON.stringify(canonicalFile(current).path)},content:'# Must remain uncommitted\\n'}]};const q=await a.nativeReplica.enqueue(h,mutation);const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');const forged={issuer:${JSON.stringify(issued.principal.issuer)},subject:${JSON.stringify(issued.principal.subject)},workspaceId:${JSON.stringify(ws.id)},kind:'notes',nativeId:q.nativeId,operationId:q.operationId,sequence:${current.revision + 1},revision:q.expectedRevision+1,contentHash:await digest(JSON.stringify([[q.changes[0].path,await digest(q.changes[0].content)]])),deleted:false};let rejected=false;try{await a.nativeReplica.acknowledge(h,forged)}catch(error){rejected=String(error).includes('observed server mutation receipt')}const count=(await a.nativeReplica.pending(h)).length;window.__ownedPending={h,q,mutation};return {forgedACKRejected:rejected,pendingRetained:count}})()`);
    assert.equal(safety.forgedACKRejected, true);
    assert.equal(safety.pendingRetained, 1);
    assert.equal(countReceipts(), receiptsBefore);
    const beforeDenied = readFileSync(join(root, 'workspace', canonicalFile(current).path), 'utf8');
    authority.revokeWorkspaceGrant(admin.credential, issued.principal.subject, ws.id);
    const revokedMutation = await win.webContents.executeJavaScript(`(async()=>{const a=window.electronAPI;const {h,q,mutation}=window.__ownedPending;let enqueueDenied=false,commitDenied=false;try{await a.nativeReplica.enqueue(h,mutation)}catch{enqueueDenied=true}try{await a.nativeData.mutate({workspaceId:${JSON.stringify(ws.id)},kind:'notes',...q})}catch{commitDenied=true}return {enqueueDenied,commitDenied}})()`);
    assert.equal(revokedMutation.enqueueDenied, true);
    assert.equal(revokedMutation.commitDenied, true);
    assert.equal(readFileSync(join(root, 'workspace', canonicalFile(current).path), 'utf8'), beforeDenied);
    const denial = await win.webContents.executeJavaScript(`window.electronAPI.nativeReplica.open(${JSON.stringify(ws.id)}).then(()=>false,()=>true)`);
    assert(denial);
    const receiptsAfter = countReceipts();
    assert.equal(receiptsAfter, receiptsBefore);
    const ownerHandle = await win.webContents.executeJavaScript('window.__ownedPending.h');
    const probePreload = join(root, 'negative-preload.cjs');
    writeFileSync(probePreload, "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('ownedNegative',{pending:h=>ipcRenderer.invoke('__nativeReplica:pending',{handle:h})});");
    other = new BrowserWindow({ show: false, webPreferences: { preload: probePreload, contextIsolation: true, nodeIntegration: false, sandbox: false } });
    other.webContents.setAudioMuted(true);
    await other.loadFile(join(root, 'fixture.html'));
    const wrongWindow = await other.webContents.executeJavaScript(`window.ownedNegative.pending(${JSON.stringify(ownerHandle)}).then(()=>false,error=>String(error).includes('not owned'))`);
    assert(wrongWindow);
    win.destroy();
    await new Promise(resolve => setTimeout(resolve, 30));
    const destroyedOwnerHandle = await other.webContents.executeJavaScript(`window.ownedNegative.pending(${JSON.stringify(ownerHandle)}).then(()=>false,error=>String(error).includes('not owned'))`);
    assert(destroyedOwnerHandle);
    const result = { status: 'passed', tier: 'authentic Electron bridge composition; NOT packaged UI E3', pid: process.pid, runtime: process.versions.electron, node: process.version, phase, createRevision: results.snapshot.revision, pendingAfterExactACK: results.pendingAfter ?? results.pending?.length, wholeChildRestart: phase === 'replay', operationHash: results.operationId ? createHash('sha256').update(results.operationId).digest('hex') : undefined, canonicalFileReadback: true, grantRevocationDenied: denial, revokedMutation, safety, canonicalBytesUnchangedAfterRevoke: true, canonicalReceiptsBefore: receiptsBefore, canonicalReceiptsAfter: receiptsAfter, wrongWindowDenied: wrongWindow, destroyedOwnerHandleRejected: destroyedOwnerHandle, injections: ['synthetic Authority bootstrap/enrollment', 'task-only credential store dependency', 'window bootstrap IPC adapters'], limitations: ['sandbox false required by existing Node-based production preload; contextIsolation true', 'Graceful process termination/restart; not SIGKILL or powerloss', 'No OS credential custody or visible product UI proof'] };
    writeFileSync(join(archive, 'result.json'), JSON.stringify(result, null, 2));
    cleanup();
    app.quit();
}).catch(error => { writeFileSync(join(archive, 'result.json'), JSON.stringify({ status: 'failed', error: String(error) }, null, 2)); cleanup(); app.exit(1); });
