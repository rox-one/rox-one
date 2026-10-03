import sys, subprocess, pathlib, json, hashlib, datetime
root=pathlib.Path(__file__).resolve().parents[5]
owner=pathlib.Path(__file__).resolve().parent
label=sys.argv[1]; command=sys.argv[2:]
paths=["apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx","apps/electron/src/renderer/components/app-shell/AppShell.tsx","apps/electron/src/renderer/atoms/unified-shell.ts","bun.lock"]
source={p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in paths}
started=datetime.datetime.now(datetime.timezone.utc).isoformat()
log=owner/"evidence"/(label+".log")
with log.open("w") as out: result=subprocess.run(command,cwd=root,stdout=out,stderr=subprocess.STDOUT)
receipt={"label":label,"command":command,"cwd":str(root),"startedAt":started,"finishedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"exitCode":result.returncode,"sourceSha256":source,"log":str(log.relative_to(root)),"logSha256":hashlib.sha256(log.read_bytes()).hexdigest()}
(owner/"evidence"/(label+".json")).write_text(json.dumps(receipt,indent=2)+"\n")
print(json.dumps({"label":label,"exitCode":result.returncode,"tail":log.read_text(errors="replace")[-6000:]}))
sys.exit(result.returncode)
