import { afterEach, expect, test, setDefaultTimeout } from 'bun:test'
import { SQL } from 'bun'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { create as createTar } from 'tar'
import { createWorkspaceServer, loadWorkspaceBootstrapMigrations } from '../../apps/workspace-service/src/server'
import { loadProtectedWorkspaceDatabaseUrl } from '../../apps/workspace-service/src/auth/postgres-identity'
import { TrustedLicenseRegistry, licenseCanonical, licenseHash } from '../../apps/workspace-service/src/modules/licenses/registry'
import { WsRpcClient } from '../../packages/server-core/src/transport/client'
import { DOMAIN_LICENSE_RPC, type LicenseComponent } from '../../packages/shared/src/workspace-domain/licenses/contracts'
setDefaultTimeout(30000)
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object'); return Object.fromEntries(Object.entries(value)) }
function string(value: unknown): string { if (typeof value !== 'string' || !value) throw new Error('Expected string'); return value }
function required<T>(value: T | undefined | null): T { if (value === undefined || value === null) throw new Error('Missing fixture'); return value }
function component(value: unknown): LicenseComponent {
  const data=object(value); const entity=object(data.entity); const reference=object(data.decisionManifest)
  if(!string(entity.entityId).startsWith('license-component:')||string(reference.resourceId)!==string(entity.entityId).slice(18)||typeof data.canAudit!=='boolean')throw new Error('Invalid component response')
  // Actual external response port; test assertions below independently check canonical fields and DB evidence.
  return value as LicenseComponent
}
export async function fixture(delayChecker = false) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'wp48-domain-')));const schema='wp48_'+randomBytes(6).toString('hex')
  const url=await loadProtectedWorkspaceDatabaseUrl(process.env.ROX_WORKSPACE_TEST_CONFIG??join(homedir(),'.agents/state/rox-compound-workspace/postgres-environment.json'))
  let database=new SQL(url,{max:12});const workspaceId=randomUUID();const resourceId=randomUUID();const issuer='urn:rox:wp48:'+randomUUID();const password='synthetic-wp48-'+randomUUID()
  const authDirectory=join(root,'auth');mkdirSync(authDirectory,{mode:0o700});const stateDirectory=join(root,'audit-state');mkdirSync(stateDirectory,{mode:0o700})
  const migrations=await loadWorkspaceBootstrapMigrations(resolve(import.meta.dir,'../../apps/workspace-service/migrations'))
  let service:Awaited<ReturnType<typeof createWorkspaceServer>>|undefined;const clients:WsRpcClient[]=[]
  let listenerPort=0
  const current=()=>required(service)
  async function stop(){for(const client of clients.splice(0))client.destroy();if(service){await service.server.close();service=undefined}}
  let disposed=false
  async function dispose(){if(disposed)return;disposed=true;const index=cleanups.indexOf(dispose);if(index>=0)cleanups.splice(index,1);await stop();try{await database.unsafe(`DROP SCHEMA "${schema}" CASCADE`)}finally{await database.close();rmSync(root,{recursive:true,force:true})}}
  cleanups.push(dispose)
  await database.unsafe(`CREATE SCHEMA "${schema}"`)
  async function start(registry?:TrustedLicenseRegistry){service=await createWorkspaceServer({database,schema,migrations,host:'127.0.0.1',port:listenerPort,serverId:'wp48-'+schema,licenseRegistry:registry,authentication:{mode:'local-bootstrap',configuration:{mode:'local-bootstrap',issuer,audience:'wp48-test',stateDirectory:authDirectory,checkoutDirectory:process.cwd(),tokenLifetimeSeconds:300}}});await service.server.listen();listenerPort=service.server.port}
  await start()
  const account=async(label:string)=>{const login=label+'-'+randomUUID()+'@example.invalid';return {login,...await current().identity.provisionAccount(login,password)}}
  const owner=await account('owner'),member=await account('member'),outsider=await account('outsider')
  await current().repository.provisionWorkspace(owner.principalId,workspaceId,'Synthetic WP48 workspace')
  await database.unsafe(`INSERT INTO "${schema}".workspace_member(workspace_id,principal_id,role) VALUES($1,$2,'member')`,[workspaceId,member.principalId])
  const staging=join(root,'staged'),payload=join(staging,'payload');mkdirSync(payload,{recursive:true})
  const notice='MIT License\nCopyright synthetic WP48 fixture only\n';writeFileSync(join(staging,'LICENSE'),notice);writeFileSync(join(payload,'LICENSE'),notice);writeFileSync(join(payload,'code.js'),"export const release = 'fixture bytes'")
  await createTar({cwd:payload,file:join(staging,'release.tgz'),gzip:true,portable:true},['LICENSE','code.js'])
  const lock=JSON.stringify({lockfileVersion:1,workspaces:{'packages/fixture':{name:'@fixture/wp48',version:'1.0.0'}},packages:{}});writeFileSync(join(root,'bun.lock'),lock)
  const codeHash=licenseHash(readFileSync(join(payload,'code.js'))),noticeHash=licenseHash(notice)
  const release={schemaVersion:1,sourceRevision:'a'.repeat(40),lockSha256:licenseHash(lock),artifacts:[{id:'fixture',kind:'workspace',path:'release.tgz',contentRoot:'payload',sha256:licenseHash(readFileSync(join(staging,'release.tgz'))),platform:'darwin',arch:'arm64',buildFlags:{format:'esm',minify:false},files:[{path:'LICENSE',sha256:noticeHash,componentId:'fixture'},{path:'code.js',sha256:codeHash,componentId:'fixture'}]}],components:[{id:'fixture',kind:'workspace',name:'@fixture/wp48',version:'1.0.0',licenseExpression:'MIT',origin:{repository:'SYNTHETIC_FIXTURE_NOT_PRODUCTION',revision:'b'.repeat(40),path:'packages/fixture/source.ts',sha256:codeHash,modifications:'',transfer:'independent'},notices:[{path:'LICENSE',sha256:noticeHash}]}]}
  const review={schemaVersion:1,policy:'LICENSE_REVIEW_REQUIRED',reviewers:[],preservedNotices:[],knownScopes:[],decisions:[]}
  writeFileSync(join(root,'release.json'),JSON.stringify(release));writeFileSync(join(root,'review.json'),JSON.stringify(review));writeFileSync(join(root,'notices.txt'),notice)
  let checker=resolve(import.meta.dir,'../../scripts/compliance/generate-sbom.ts');
  if(delayChecker){const directory=join(root,'checker');mkdirSync(directory);symlinkSync(realpathSync(resolve(import.meta.dir,'../../node_modules')),join(directory,'node_modules'),'dir');for(const name of ['generate-sbom.ts','collect-build-attribution.ts','verify-registry-attribution.ts']){let source=readFileSync(join(checker,'..',name),'utf8');if(name==='generate-sbom.ts')source=source.replace('if (import.meta.main) {','if (import.meta.main) { await Bun.sleep(1500)');writeFileSync(join(directory,name),source)}checker=join(directory,'generate-sbom.ts')}
  const modules=['generate-sbom.ts','collect-build-attribution.ts','verify-registry-attribution.ts'].map(name=>{const path=join(checker,'..',name);return {path,sha256:licenseHash(readFileSync(path))}})
  const preflight=join(root,'preflight.json');const checkerRevision='c'.repeat(40),reviewRevision='d'.repeat(40)
  const preflightProcess=Bun.spawnSync([process.execPath,checker,'check','--release',join(root,'release.json'),'--root',staging,'--lock',join(root,'bun.lock'),'--decisions',join(root,'review.json'),'--notices',join(root,'notices.txt'),'--source-revision',release.sourceRevision,'--review-revision',reviewRevision,'--auditor-revision',checkerRevision,'--output',preflight],{stdout:'pipe',stderr:'pipe'})
  if(preflightProcess.exitCode!==1)throw new Error('Expected actual unreviewed checker result: '+preflightProcess.stderr.toString())
  const audit=object(JSON.parse(readFileSync(preflight,'utf8')));if(!Array.isArray(audit.artifactDigests))throw new Error('Missing checker digests')
  const build={schemaVersion:1,artifactDigest:licenseHash(licenseCanonical(audit.artifactDigests)),sbomDigest:string(audit.sbomSha256),releaseSha256:licenseHash(readFileSync(join(root,'release.json'))),lockSha256:licenseHash(lock),reviewSha256:licenseHash(readFileSync(join(root,'review.json'))),noticeSha256:noticeHash,sourceRevision:release.sourceRevision,reviewRevision,checkerRevision,checkerSha256:licenseHash(readFileSync(checker)),producerRevision:'e'.repeat(40)}
  writeFileSync(join(root,'build.json'),JSON.stringify(build),{mode:0o600})
  const file=(name:string)=>({path:join(root,name),sha256:licenseHash(readFileSync(join(root,name)))})
  const registryConfig={schemaVersion:1,stateDirectory,checker:{path:checker,sha256:build.checkerSha256,revision:checkerRevision,bunSha256:licenseHash(readFileSync(process.execPath)),modules},resources:[{resourceId,workspaceId,label:'PRIVATE_WP-48 synthetic artifact',root:staging,release:file('release.json'),lock:file('bun.lock'),review:file('review.json'),notices:file('notices.txt'),build:file('build.json'),policy:{mode:'owner_bootstrap',read:true,write:true,action:true}}]}
  const configPath=join(root,'registry.json');writeFileSync(configPath,JSON.stringify(registryConfig),{mode:0o600})
  const registry=await TrustedLicenseRegistry.load(configPath);await stop();await start(registry)
  async function http(path:string,token?:string,body?:unknown){const response=await fetch(`http://127.0.0.1:${current().server.port}${path}`,{method:body===undefined?'GET':'POST',headers:{...(token?{authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});const text=await response.text();return {status:response.status,text,body:JSON.parse(text) as unknown}}
  const token=async(login:string)=>string(object((await http('/v1/auth/local/token',undefined,{login,password})).body).token)
  const ownerToken=await token(owner.login),memberToken=await token(member.login),outsiderToken=await token(outsider.login)
  async function ws(token:string){const client=new WsRpcClient(`ws://127.0.0.1:${current().server.port}`,{token,workspaceId,mode:'remote',autoReconnect:false,connectTimeout:2000,requestTimeout:15000});clients.push(client);await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('WS handshake timeout')),2500);const off=client.onConnectionStateChanged(state=>{if(state.status==='connected'){clearTimeout(timer);off();resolve()}else if(state.status==='failed'||state.status==='disconnected'){clearTimeout(timer);off();reject(new Error('WS handshake denied'))}});client.connect()});return client}
  const prefix='/v1/workspaces/'+workspaceId;const entityId='license-component:'+resourceId
  const get=async()=>component((await http(prefix+'/licenses/'+resourceId,ownerToken)).body)
  const command=async()=>{const row=await get();return {commandId:randomUUID(),schemaVersion:2,workspaceId,idempotencyKey:randomUUID(),expectedRevision:row.revision,payload:{artifactDigest:row.artifactDigest,sbomDigest:row.sbomDigest,decisionManifest:row.decisionManifest}}}
  const counts=async()=>{const [row]=await database.unsafe<{receipts:number;events:number;revision:string}[]>(`SELECT (SELECT count(*)::integer FROM "${schema}".license_audit_receipt) AS receipts,(SELECT count(*)::integer FROM "${schema}".project_event WHERE type='audit.license_reviewed') AS events,(SELECT revision::text FROM "${schema}".license_component WHERE resource_id=$1) AS revision`,[resourceId]);return required(row)}
  const restart=async()=>{await stop();await database.close();database=new SQL(url,{max:12});await start(await TrustedLicenseRegistry.load(configPath))}
  return {root,get database(){return database},restart,schema,workspaceId,resourceId,entityId,registry,configPath,registryConfig,current,start,stop,dispose,http,ws,prefix,owner,member,outsider,ownerToken,memberToken,outsiderToken,password,get,command,counts,stateDirectory}
}
test('actual checker persists review_required through canonical HTTP/WS, receipt and atomic reference event',async()=>{
  const f=await fixture();const client=await f.ws(f.ownerToken);const initial=await f.get();expect(initial.revision).toBe('0');expect(initial.evidence).toBeNull();expect(initial.canAudit).toBe(true)
  const command=await f.command();const response=await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,command);expect(response.status).toBe(200)
  const result=object(response.body),data=component(result.data);expect(result.status).toBe('applied');expect(result.verification).toBe('receipt_verified');expect(data.evidence?.state).toBe('review_required');expect(data.evidence?.findings.some(x=>x.code==='SCOPED_DECISION_REQUIRED')).toBe(true)
  expect(await client.invoke(DOMAIN_LICENSE_RPC.GET,f.workspaceId,{entityId:f.entityId})).toEqual(data);expect(await f.counts()).toEqual({receipts:1,events:1,revision:'1'})
  const events=object(await client.invoke(DOMAIN_LICENSE_RPC.EVENTS,f.workspaceId,{entityId:f.entityId}));expect(Array.isArray(events.events)).toBe(true);const event=object(required((events.events as unknown[])[0]));expect(event.type).toBe('audit.license_reviewed');expect(JSON.stringify(event)).not.toContain('PRIVATE_WP-48');expect(JSON.stringify(event)).not.toContain('@example.invalid');expect(Object.keys(object(event.payload)).sort()).toEqual(['artifactDigest','auditDigest','entityId','sbomDigest'])
  const consumed:string[]=[];while(await f.current().repository.consumeNextEvent('wp48-consumer',async(_tx,event)=>{consumed.push(event.type)})){}
  expect(consumed.filter(type=>type==='audit.license_reviewed')).toHaveLength(1)
})
test('real member/outsider and forged actor/workspace/approval/path cannot cross Resource boundary',async()=>{
  const f=await fixture();const body=await f.command();const denied=await f.http(f.prefix+'/licenses',f.memberToken);expect(denied.status).toBe(403);expect(denied.text).not.toContain('PRIVATE_WP-48');await expect(f.ws(f.outsiderToken)).rejects.toThrow()
  expect((await f.http(f.prefix+'/commands/audit.releaseLicense',f.memberToken,body)).status).toBe(403)
  for(const forged of [{...body,actor:{principalId:f.owner.principalId}},{...body,workspaceId:randomUUID()},{...body,payload:{...body.payload,executable:'/tmp/evil'}},{...body,payload:{...body.payload,decisionManifest:{...body.payload.decisionManifest,decisions:[{outcome:'approved',reviewer:'producer'}]}}}])expect([400,403]).toContain((await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,forged)).status)
  expect(await f.counts()).toEqual({receipts:0,events:0,revision:'0'})
})
test('concurrent idempotency, full listener restart and authorized event cursor recover one original receipt',async()=>{
  const f=await fixture();const client=await f.ws(f.ownerToken);const command=await f.command();const [http,ws]=await Promise.all([f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,command),client.invoke(DOMAIN_LICENSE_RPC.AUDIT,f.workspaceId,command)]);expect(http.status).toBe(200);expect(ws).toEqual(http.body);expect(required(f.current().licenseRepository).observability.snapshot()).toEqual({applied:1,replayed:1,conflicts:0,failed:0})
  const page=object((await f.http(f.prefix+'/licenses/'+f.resourceId+'/events',f.ownerToken)).body);const cursor=string(page.nextCursor)
  await f.restart();const replay=await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,command);expect(replay.body).toEqual(http.body);expect(await f.counts()).toEqual({receipts:1,events:1,revision:'1'})
  const next=object((await f.http(f.prefix+'/licenses/'+f.resourceId+'/events?cursor='+cursor,f.ownerToken)).body);expect(next.events).toEqual([])
  expect((await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,{...command,commandId:randomUUID(),idempotencyKey:randomUUID()})).status).toBe(409)
  expect((await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,{...command,payload:{...command.payload,sbomDigest:'f'.repeat(64)}})).status).toBe(409)
})
test('server-side read/write/action grants independently deny audit and retract evidence',async()=>{
  const f=await fixture();const command=await f.command();await f.database.unsafe(`UPDATE "${f.schema}".license_component SET can_action=false,policy_epoch=policy_epoch+1 WHERE resource_id=$1`,[f.resourceId]);expect((await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,command)).status).toBe(403);expect((await f.get()).canAudit).toBe(false)
  await f.database.unsafe(`UPDATE "${f.schema}".license_component SET can_read=false WHERE resource_id=$1`,[f.resourceId]);expect((await f.http(f.prefix+'/licenses/'+f.resourceId,f.ownerToken)).status).toBe(403);expect(await f.counts()).toEqual({receipts:0,events:0,revision:'0'})
})
test('actual immutable review byte tamper yields genuine error with no aggregate/receipt/event effect',async()=>{
  const f=await fixture();const command=await f.command();writeFileSync(join(f.root,'review.json'),'malicious producer review bytes');const response=await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,command);expect(response.status).toBe(503);expect(response.text).not.toContain(f.root);expect(await f.counts()).toEqual({receipts:0,events:0,revision:'0'})
})
test('stored receipt and independent event binding corruption are rejected instead of replayed as verification',async()=>{
  const f=await fixture();const command=await f.command();expect((await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,command)).status).toBe(200)
  await f.database.unsafe(`UPDATE "${f.schema}".license_audit_receipt SET result=jsonb_set(result,'{data,sbomDigest}',to_jsonb($1::text))`,['f'.repeat(64)]);expect((await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,command)).status).toBe(503)
  expect(await f.counts()).toEqual({receipts:1,events:1,revision:'1'})
})
test('live persisted session expiry after checker admission rolls back all canonical effects',async()=>{
  const f=await fixture(true);const command=await f.command();const session=object((await f.current().actorResolver.authenticate(f.ownerToken)).actor)
  await f.database.unsafe(`UPDATE "${f.schema}".bootstrap_auth_session SET expires_at=clock_timestamp()+interval '700 milliseconds' WHERE session_id=$1`,[string(session.sessionId)])
  const responsePromise=f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,command)
  let admitted=false;const until=Date.now()+2000
  while(Date.now()<until){if(readdirSync(f.stateDirectory).some(name=>name.startsWith('audit-'))){admitted=true;break}await Bun.sleep(5)}
  const response=await responsePromise
  expect(admitted).toBe(true)
  expect(response.status).toBe(401);expect(await f.counts()).toEqual({receipts:0,events:0,revision:'0'})
})
test('schema downgrade and tampered independent event references cannot produce verified replay',async()=>{
  const f=await fixture();const command=await f.command();expect((await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,{...command,schemaVersion:1})).status).toBe(400)
  expect((await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,command)).status).toBe(200)
  await f.database.unsafe(`UPDATE "${f.schema}".project_event SET payload=jsonb_set(payload,'{auditDigest}',to_jsonb($1::text)) WHERE type='audit.license_reviewed'`,['f'.repeat(64)]);expect((await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,command)).status).toBe(503)
})
test('actual registered final archive mutation fails before any canonical effect',async()=>{
  const f=await fixture();const command=await f.command();const path=join(f.root,'staged/release.tgz');const bytes=readFileSync(path);bytes[10]=(bytes[10]??0)^1;writeFileSync(path,bytes)
  expect((await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,command)).status).toBe(503);expect(await f.counts()).toEqual({receipts:0,events:0,revision:'0'})
})
test('coherently changed receipt timestamp and JSON still fail independent immutable event binding',async()=>{
  const f=await fixture();const command=await f.command();expect((await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,command)).status).toBe(200)
  await f.database.unsafe(`UPDATE "${f.schema}".license_audit_receipt SET created_at=created_at+interval '1 second',result=jsonb_set(jsonb_set(jsonb_set(result,'{verifiedAt}',to_jsonb($1::text)),'{data,auditedAt}',to_jsonb($1::text)),'{receipt,verifiedAt}',to_jsonb($1::text))`,['2026-09-30T01:02:03.000Z']);expect((await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,command)).status).toBe(503)
})

// Keep the original authenticated identity endpoint intact: the existing encrypted intent mechanism depends on it.
test('license integration preserves authenticated identity scope and rejects body/query additions',async()=>{
  const f=await fixture();const scope=await f.http(f.prefix+'/identity',f.ownerToken);expect(scope.status).toBe(200)
  const bound=object(scope.body);expect(Object.keys(bound).sort()).toEqual(['deviceId','expiresAt','issuer','principalId','sessionId','workspaceId']);expect(bound.principalId).toBe(f.owner.principalId);expect(bound.workspaceId).toBe(f.workspaceId)
  expect((await f.http(f.prefix+'/identity?limit=1',f.ownerToken)).status).toBe(400);expect((await f.http(f.prefix+'/identity')).status).toBe(401)
  expect((await f.http(f.prefix+'/licenses/%XX',f.ownerToken)).status).toBe(400)
})
test('private audit events never enter global project replay for owner or member while inbox delivery remains atomic',async()=>{
  const f=await fixture();expect((await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,await f.command())).status).toBe(200)
  for(const token of [f.ownerToken,f.memberToken]){
    const replay=await f.http(f.prefix+'/events',token);expect(replay.status).toBe(200);expect(replay.text).not.toContain('audit.license_reviewed');expect(replay.text).not.toContain(f.entityId)
    const client=await f.ws(token);const ws=JSON.stringify(await client.invoke('domain.project.events',f.workspaceId,{}));expect(ws).not.toContain('audit.license_reviewed');expect(ws).not.toContain(f.entityId)
  }
  expect((await f.http(f.prefix+'/licenses/'+f.resourceId+'/events',f.memberToken)).status).toBe(403)
  const consumed:string[]=[];while(await f.current().repository.consumeNextEvent('private-resource-inbox',async(_tx,event)=>{consumed.push(event.type)})){}
  expect(consumed.filter(type=>type==='audit.license_reviewed')).toHaveLength(1)
})
test('malformed persisted license event UUID fails inbox effect and watermark transaction',async()=>{
  const f=await fixture();expect((await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,await f.command())).status).toBe(200)
  await f.database.unsafe(`UPDATE "${f.schema}".project_event SET payload=jsonb_set(payload,'{entityId}',to_jsonb($1::text)) WHERE type='audit.license_reviewed'`,['license-component:'+'-'.repeat(36)])
  const consumed:string[]=[];while(await f.current().repository.consumeNextEvent('invalid-audit-uuid',async(_tx,event)=>{consumed.push(event.type)}).catch((error:unknown)=>{expect(object(error).code).toBe('PROVIDER_UNAVAILABLE');return false})){}
  expect(consumed).not.toContain('audit.license_reviewed')
  const [row]=await f.database.unsafe<{count:number}[]>(`SELECT count(*)::integer AS count FROM "${f.schema}".project_event_inbox i JOIN "${f.schema}".project_event e USING(event_id) WHERE i.consumer_id='invalid-audit-uuid' AND e.type='audit.license_reviewed'`)
  expect(required(row).count).toBe(0)
})

test('GET and LIST both reject each forged immutable Resource column over HTTP and WS',async()=>{
  const f=await fixture();const client=await f.ws(f.ownerToken);const initial=await f.get()
  const [stored]=await f.database.unsafe<{label:string;binding_sha256:string;artifact_digest:string;sbom_digest:string}[]>(`SELECT label,binding_sha256,artifact_digest,sbom_digest FROM "${f.schema}".license_component WHERE resource_id=$1`,[f.resourceId]);const original=required(stored)
  for(const column of ['label','binding_sha256','artifact_digest','sbom_digest'] as const){
    const forged=column==='label'?'FORGED_PRIVATE_LABEL':'f'.repeat(64)
    await f.database.unsafe(`UPDATE "${f.schema}".license_component SET ${column}=$1 WHERE resource_id=$2`,[forged,f.resourceId])
    expect((await f.http(f.prefix+'/licenses/'+f.resourceId,f.ownerToken)).status).toBe(503)
    const list=await f.http(f.prefix+'/licenses',f.ownerToken);expect(list.status).toBe(503);expect(list.text).not.toContain(forged)
    await expect(client.invoke(DOMAIN_LICENSE_RPC.GET,f.workspaceId,{entityId:f.entityId})).rejects.toThrow()
    await expect(client.invoke(DOMAIN_LICENSE_RPC.LIST,f.workspaceId,{})).rejects.toThrow()
    await f.database.unsafe(`UPDATE "${f.schema}".license_component SET ${column}=$1 WHERE resource_id=$2`,[original[column],f.resourceId])
  }
  expect(await f.get()).toEqual(initial)
})
test('strict common audit event proof rejects invalid digest, correlation and absent Resource across event/readback/receipt/inbox paths',async()=>{
  const f=await fixture();const command=await f.command();expect((await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,command)).status).toBe(200)
  const client=await f.ws(f.ownerToken)
  const [stored]=await f.database.unsafe<{payload:unknown;correlation_id:string}[]>(`SELECT payload,correlation_id FROM "${f.schema}".project_event WHERE type='audit.license_reviewed'`);const original=required(stored)
  for(const variant of ['digest','correlation','absent-resource'] as const){
    const forged=variant==='digest'?{...object(original.payload),auditDigest:'INVALID_DIGEST_PRIVATE_MARKER'}:variant==='absent-resource'?{...object(original.payload),entityId:'license-component:00000000-0000-0000-0000-000000000000'}:original.payload
    await f.database.unsafe(`UPDATE "${f.schema}".project_event SET payload=$1::jsonb,correlation_id=$2 WHERE type='audit.license_reviewed'`,[forged,variant==='correlation'?randomUUID():original.correlation_id])
    expect((await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,command)).status).toBe(503)
    await expect(client.invoke(DOMAIN_LICENSE_RPC.AUDIT,f.workspaceId,command)).rejects.toThrow()
    const events=await f.http(f.prefix+'/licenses/'+f.resourceId+'/events',f.ownerToken)
    // A tampered resource ref cannot be selected by another Resource's events route; it never emits any forged reference.
    expect(events.status).toBe(503);expect(events.text).not.toContain('INVALID_DIGEST_PRIVATE_MARKER')
    await expect(client.invoke(DOMAIN_LICENSE_RPC.EVENTS,f.workspaceId,{entityId:f.entityId})).rejects.toThrow()
    const consumed:string[]=[];const consumer='strict-event-'+variant;let rejected=false
    while(await f.current().repository.consumeNextEvent(consumer,async(_tx,event)=>{consumed.push(event.type)}).catch((error:unknown)=>{expect(object(error).code).toBe('PROVIDER_UNAVAILABLE');rejected=true;return false})){}
    expect(rejected).toBe(true);expect(consumed).toContain('workspace.member_joined');expect(consumed).not.toContain('audit.license_reviewed')
    const [count]=await f.database.unsafe<{count:number}[]>(`SELECT count(*)::integer AS count FROM "${f.schema}".project_event_inbox i JOIN "${f.schema}".project_event e USING(event_id) WHERE i.consumer_id=$1 AND e.type='audit.license_reviewed'`,[consumer]);expect(required(count).count).toBe(0)
    await f.database.unsafe(`UPDATE "${f.schema}".project_event SET payload=$1::jsonb,correlation_id=$2 WHERE type='audit.license_reviewed'`,[original.payload,original.correlation_id])
  }
})
test('coherent projection evidence plus digest cannot invent reviewed clearance on GET or LIST',async()=>{
  const f=await fixture();expect((await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,await f.command())).status).toBe(200)
  const initial=await f.get();const altered={state:'reviewed_exact_artifact',findings:[],components:[]}
  await f.database.unsafe(`UPDATE "${f.schema}".license_component SET evidence=$1::jsonb,audit_digest=$2 WHERE resource_id=$3`,[altered,licenseHash(licenseCanonical(altered)),f.resourceId])
  const client=await f.ws(f.ownerToken)
  for(const route of ['/licenses/'+f.resourceId,'/licenses']){const response=await f.http(f.prefix+route,f.ownerToken);expect(response.status).toBe(503);expect(response.text).not.toContain('reviewed_exact_artifact')}
  await expect(client.invoke(DOMAIN_LICENSE_RPC.GET,f.workspaceId,{entityId:f.entityId})).rejects.toThrow()
  await expect(client.invoke(DOMAIN_LICENSE_RPC.LIST,f.workspaceId,{})).rejects.toThrow()
  await f.database.unsafe(`UPDATE "${f.schema}".license_component SET evidence=$1::jsonb,audit_digest=$2 WHERE resource_id=$3`,[initial.evidence,initial.auditDigest,f.resourceId]);expect(await f.get()).toEqual(initial)
})
test('actual Resource READ revoke after domain result and before HTTP/WS serialization retracts outbound private bytes',async()=>{
  const f=await fixture();expect((await f.http(f.prefix+'/commands/audit.releaseLicense',f.ownerToken,await f.command())).status).toBe(200)
  const client=await f.ws(f.ownerToken)
  const resolver=f.current().actorResolver,original=resolver.revalidate.bind(resolver)
  for(const transport of ['HTTP','WS'] as const){
    await f.database.unsafe(`UPDATE "${f.schema}".license_component SET can_read=true WHERE resource_id=$1`,[f.resourceId])
    let arrivals=0;let admit:(()=>void)|undefined,release:(()=>void)|undefined
    const admitted=new Promise<void>(resolve=>{admit=resolve}),barrier=new Promise<void>(resolve=>{release=resolve})
    resolver.revalidate=async bound=>{const current=await original(bound);if(++arrivals===2){required(admit)();await barrier}return current}
    const result=transport==='HTTP'?f.http(f.prefix+'/licenses/'+f.resourceId,f.ownerToken):client.invoke(DOMAIN_LICENSE_RPC.GET,f.workspaceId,{entityId:f.entityId}).then(value=>({status:200,text:JSON.stringify(value),body:value})).catch((error:unknown)=>({status:403,text:String(object(error).code),body:{error:{code:object(error).code}}}))
    await Promise.race([admitted,Bun.sleep(5000).then(()=>{throw new Error('Actual outbound identity barrier was not reached')})])
    await f.database.unsafe(`UPDATE "${f.schema}".license_component SET can_read=false,policy_epoch=policy_epoch+1 WHERE resource_id=$1`,[f.resourceId])
    required(release)();const received=await result;expect(received.status).toBe(403);expect(object(object(received.body).error).code).toBe('FORBIDDEN');expect(received.text).not.toContain('PRIVATE_WP-48');expect(received.text).not.toContain('review_required')
    resolver.revalidate=original
  }
})
