import sys, subprocess, pathlib, json, hashlib, datetime, os
root=pathlib.Path(__file__).resolve().parents[5]
owner=pathlib.Path(__file__).resolve().parent
label=sys.argv[1]; command=sys.argv[2:]
paths=["apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx","apps/electron/src/renderer/components/app-shell/AppShell.tsx","apps/electron/src/renderer/atoms/unified-shell.ts","apps/electron/src/renderer/contexts/NavigationContext.tsx","apps/electron/src/shared/route-parser.ts","apps/electron/src/shared/types.ts","apps/electron/src/renderer/pages/SkillInfoPage.tsx","apps/electron/src/renderer/lib/nav-helpers.ts","apps/electron/src/renderer/atoms/panel-stack.ts","bun.lock"]
paths += ["apps/electron/src/renderer/components/app-shell/PanelSlot.tsx", "apps/electron/src/renderer/hooks/usePanelResize.ts", "apps/electron/src/renderer/components/app-shell/panel-constants.ts", "apps/electron/src/renderer/lib/panel-workspace-layout.ts", "apps/electron/src/renderer/atoms/sessions.ts", "apps/electron/src/renderer/lib/local-storage.ts", "apps/electron/src/renderer/components/app-shell/PanelStackContainer.tsx"]
paths += ["apps/electron/src/renderer/App.tsx", "apps/electron/src/renderer/components/app-shell/service-navigation.ts", "apps/electron/src/renderer/components/app-shell/nav-destinations.ts"]
paths += ["apps/electron/src/renderer/contexts/navigation-history.ts"]
paths += ["apps/electron/src/renderer/lib/panel-url.ts", "apps/electron/src/renderer/lib/route-recovery.tsx", "apps/electron/src/renderer/contexts/navigation-reconcile.ts"]
source={p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in paths}
started=datetime.datetime.now(datetime.timezone.utc).isoformat()
log=owner/"evidence"/(label+".log")
if log.exists() or (owner/"evidence"/(label+".json")).exists():
    raise SystemExit("Evidence label already exists; use a fresh label to preserve history")
head=subprocess.check_output(["git","rev-parse","HEAD"],cwd=root,text=True).strip()
integration_base=subprocess.check_output(["git","rev-parse","origin/main"],cwd=root,text=True).strip()
with log.open("w") as out: result=subprocess.run(command,cwd=root,stdout=out,stderr=subprocess.STDOUT)
after={p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in paths}
receipt={"label":label,"command":command,"cwd":str(root),"inputHead":head,"integrationBase":integration_base,"startedAt":started,"finishedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"exitCode":result.returncode,"sourceSha256":source,"sourceAfterSha256":after,"sourcesStable":source==after,"log":str(log.relative_to(root)),"logSha256":hashlib.sha256(log.read_bytes()).hexdigest()}
receipt['testEnvironment']={key:os.environ[key] for key in ['ROX_UI001_BROWSER_EXECUTABLE','ROX_UI001_CHROMIUM_EXECUTABLE','ROX_UI001_BROWSER_TEST','ROX_UI001_BROWSER_CHANNEL','ROX_SKILL_INFO_BROWSER_TEST','ROX_SKILL_INFO_FIXTURE_BUNDLE','CHROMIUM_EXECUTABLE','NODE_OPTIONS','PLAYWRIGHT_BROWSERS_PATH'] if key in os.environ}
(owner/"evidence"/(label+".json")).write_text(json.dumps(receipt,indent=2)+"\n")
print(json.dumps({"label":label,"exitCode":result.returncode,"tail":log.read_text(errors="replace")[-6000:]}))
sys.exit(result.returncode)
