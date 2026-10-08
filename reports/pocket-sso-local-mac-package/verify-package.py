from pathlib import Path
import json,hashlib,subprocess,datetime,shutil
s=Path('/tmp/rox-pocket-mac-package-aa80-20261004');r=Path(__file__).parent
release=s/'apps/electron/release'; app=release/'mac-arm64/Rox.app'; contents=app/'Contents'; resources=contents/'Resources';payload=resources/'app'
manifest=json.loads((release/'manifest-darwin-arm64.json').read_text())
assert manifest['commit']=='aa80de1b44d12a3fbbf425ce5aca8709617972ca'
assert manifest['platform']=='darwin' and manifest['arch']=='arm64' and manifest['signed'] is False
checks=[]
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
def run(name,argv,expected=0):
 p=subprocess.run(argv,capture_output=True,text=True)
 (r/(name+'.log')).write_text(p.stdout+p.stderr)
 checks.append(dict(check=name,argv=argv,exitCode=p.returncode,expectedExitCode=expected))
 if p.returncode!=expected: raise RuntimeError(name+' failed '+str(p.returncode))
 return p.stdout+p.stderr
artifacts=[]
for entry in manifest['artifacts']:
 p=release/entry['name']; sha=digest(p)
 assert p.stat().st_size==entry['size'] and sha==entry['sha256']
 artifacts.append(dict(entry,path=str(p)))
run('zip-integrity',['/usr/bin/unzip','-tqq',str(release/'Rox-arm64.zip')])
run('dmg-integrity',['/usr/bin/hdiutil','verify',str(release/'Rox-arm64.dmg')])
signature=run('codesign-details',['/usr/bin/codesign','-dv','--verbose=4',str(app)])
assert 'Signature=adhoc' in signature and 'TeamIdentifier=not set' in signature and 'Authority=Developer ID' not in signature
run('codesign-integrity',['/usr/bin/codesign','--verify','--deep','--strict','--verbose=2',str(app)])
critical=['Contents/MacOS/Rox','Contents/Resources/app/dist/main.cjs','Contents/Resources/app/dist/bootstrap-preload.cjs','Contents/Resources/app/dist/browser-toolbar-preload.cjs','Contents/Resources/app/dist/renderer/index.html','Contents/Resources/app/resources/pi-agent-server/index.js','Contents/Resources/app/vendor/bun/bun','Contents/Resources/app/resources/bin/darwin-arm64/uv','Contents/Resources/app/node_modules/@anthropic-ai/claude-agent-sdk-binary/claude','Contents/Resources/app/node_modules/@tursodatabase/database-darwin-arm64/package.json','Contents/Resources/app-update.yml','Contents/Info.plist']
files=[]
for name in critical:
 p=app/name
 assert p.exists(),name
 files.append(dict(path=name,size=p.stat().st_size,sha256=digest(p)))
for name in ['Contents/MacOS/Rox','Contents/Resources/app/vendor/bun/bun','Contents/Resources/app/resources/bin/darwin-arm64/uv','Contents/Resources/app/node_modules/@anthropic-ai/claude-agent-sdk-binary/claude']:
 detail=run('architecture-'+Path(name).name,['/usr/bin/file',str(app/name)])
 assert 'arm64' in detail,detail
node='/opt/homebrew/opt/node@22/bin/node'
plist=run('packaged-electron-plist',['/usr/libexec/PlistBuddy','-c','Print :CFBundleVersion',str(contents/'Frameworks/Electron Framework.framework/Resources/Info.plist')])
assert plist.strip()=='39.2.7',plist
tracked=subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=s,text=True).strip();assert not tracked
for p in release.iterdir():
 if p.is_file() and (p.name.endswith('.yml') or p.name.startswith('manifest-')):shutil.copy2(p,r/p.name)
receipt=dict(sourceCommit=manifest['commit'],sourceTrackedStatus=tracked,platform='darwin-arm64',appPath=str(app),canonicalManifestCredentialSignedFlag=False,actualSignature='adhoc',developerIdSigned=False,notarized=False,published=False,electronVersion=plist.strip(),artifacts=artifacts,criticalPackagedFiles=files,checks=checks,verifiedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),scope='Local packaged artifact integrity and headless Keychain persistence. GUI first launch, Pocket login, provider canary and release acceptance pending.')
(r/'package-verification.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(dict(packagePassed=True,sourceCommit=manifest['commit'],actualSignature='adhoc',artifacts=artifacts),indent=2))
