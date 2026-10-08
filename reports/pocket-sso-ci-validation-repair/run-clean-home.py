#!/usr/bin/env python3
"""Run the exact release ownership step with an owned clean HOME/config.
Local macOS proof models an unavailable OS keychain through a PATH-only CLI
fixture. The actual encrypted-file credential backend remains in use.
"""
import argparse, datetime, hashlib, json, os, pathlib, subprocess, tempfile
p=argparse.ArgumentParser(); p.add_argument('--bun',required=True); p.add_argument('--label',default='final-clean-home-workflow-step'); args=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[2]; report=pathlib.Path(__file__).resolve().parent
block=(root/'.github/workflows/desktop-release.yml').read_text().split('- name: Pocket account and execution ownership regressions',1)[1].split('\n      - name:',1)[0]
command=block.split('run: >-',1)[1].split(); assert command[:4]==['bun','test','--timeout','180000'] and len(command[4:])==10
command[0]=str(pathlib.Path(args.bun).resolve())
owned=pathlib.Path(tempfile.mkdtemp(prefix='rox-pocket-ci-owned-',dir='/tmp')); home=owned/'home'; home.mkdir(); config=owned/'config'; config.mkdir(); bin_dir=owned/'bin'; bin_dir.mkdir()
security=bin_dir/'security'; security.write_text('#!/bin/sh\n# Test-only: OS credential provider unavailable; use real file fallback.\nexit 1\n'); security.chmod(0o755)
env=dict(os.environ)
for key in ['ROX_API_KEY','PI_CODING_AGENT_DIR','OMP_PROFILE','PI_CONFIG_FILES','OMP_CLI_PATH','ROX_OMP_TEST_TIMEOUT_MS']: env.pop(key,None)
env.update(HOME=str(home),USERPROFILE=str(home),ROX_CONFIG_DIR=str(config),CRAFT_CONFIG_DIR=str(config),PATH=str(bin_dir)+os.pathsep+env.get('PATH',''))
started=datetime.datetime.now(datetime.timezone.utc).isoformat()
with (report/(args.label+'.log')).open('w') as log: result=subprocess.run(command,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
receipt={'exitCode':result.returncode,'command':command,'exactWorkflowStep':True,'files':10,'ownedRoot':str(owned),'home':str(home),'config':str(config),'ambientHomeModelsPresentAfter':(home/'.omp/agent/models.yml').exists(),'keychainSeam':{'command':'security','exitCode':1,'sha256':hashlib.sha256(security.read_bytes()).hexdigest(),'actualEncryptedFileBackend':True},'startedAt':started,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'bunSha256':hashlib.sha256(pathlib.Path(args.bun).read_bytes()).hexdigest()}
(report/(args.label+'-result.json')).write_text(json.dumps(receipt,indent=2)+'\n'); print(json.dumps(receipt)); raise SystemExit(result.returncode)
