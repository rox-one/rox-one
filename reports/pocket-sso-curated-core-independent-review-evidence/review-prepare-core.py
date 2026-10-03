import hashlib, io, json, pathlib, shutil, subprocess, tarfile, tempfile

delivery = pathlib.Path('/Users/t/Projects/rox-sso-ops-delivery-20261003')
source = delivery / 'deploy/sw/pocket-sso'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
manifest = json.loads((source / 'core-source-manifest.json').read_text())
results = []
with tempfile.TemporaryDirectory(prefix='pocket-core-review-') as scratch:
    root = pathlib.Path(scratch)
    good = root / 'good'
    result = subprocess.run(['python3', str(source/'prepare-core.py'), str(good)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    final = {**manifest['baselineFiles'], **manifest['patchedFiles'], **manifest['newFiles']}
    assert all(sha(good/p) == v for p,v in final.items())
    actual = {str(p.relative_to(good)) for p in good.rglob('*') if p.is_file()}
    assert actual == set(final) | {'Dockerfile.pocket'}
    assert sha(good/'Dockerfile.pocket') == manifest['coreRecipeSha256']
    source_bound = []
    for p,v in {**manifest['patchedFiles'],**manifest['newFiles']}.items():
        actual_hash = hashlib.sha256(subprocess.check_output(['git','show',manifest['maintainedSourceRevision']+':'+p],cwd=delivery)).hexdigest()
        assert actual_hash == v
        source_bound.append(p)
    baseline_bound = 0
    for p,v in manifest['baselineFiles'].items():
        actual_hash = hashlib.sha256(subprocess.check_output(['git','show',manifest['liveSourceFreeze']+':'+p],cwd=delivery)).hexdigest()
        assert actual_hash == v
        baseline_bound += 1
    tested = json.loads((delivery/'reports/pocket-sso-curated-delivery/tested-core-runtime-hashes.json').read_text())
    curated = json.loads((delivery/'reports/pocket-sso-curated-delivery/curated-core-runtime-hashes.json').read_text())
    assert tested == curated
    results.append({'case':'reconstruction-source-bind','passed':True,'baselineFiles':baseline_bound,'maintainedFiles':len(source_bound),'outputFiles':len(actual),'compiledManifestFiles':len(curated['files']),'compiledManifestsIdentical':True,'scope':'Local reconstruction and retained runtime hash manifests; no image rebuild or deployment.'})

    for mode in ['archive','patch','recipe','overlay','existing']:
        copied = root / mode / 'delivery'
        shutil.copytree(source,copied)
        destination = root / mode / 'result'
        if mode == 'existing':
            destination.mkdir(); (destination/'sentinel').write_text('preserve-owned-control')
        else:
            target = copied / {'archive':'core-baseline.tar.gz','patch':'core.patch','recipe':'Dockerfile.core','overlay':'core-files/packages/core/src/rox-accounts.ts'}[mode]
            target.write_bytes(target.read_bytes()+b'\nreview-control-mutant')
        result = subprocess.run(['python3',str(copied/'prepare-core.py'),str(destination)],capture_output=True,text=True)
        assert result.returncode != 0
        if mode == 'existing': assert (destination/'sentinel').read_text() == 'preserve-owned-control'
        else: assert not destination.exists()
        assert not list(destination.parent.glob('.pocket-core-context-*'))
        results.append({'case':mode,'rejected':True,'destinationPreservedOrAbsent':True,'scratchRemoved':True})

    for mode in ['traversal','symlink','duplicate']:
        copied = root / mode / 'delivery'; shutil.copytree(source,copied)
        forged = copied/'core-baseline.tar.gz'
        with tarfile.open(forged,'w:gz') as archive:
            member = tarfile.TarInfo('../escape' if mode=='traversal' else 'link' if mode=='symlink' else 'file')
            if mode=='symlink': member.type=tarfile.SYMTYPE; member.linkname='../escape'; archive.addfile(member)
            else:
                member.size=1; archive.addfile(member,io.BytesIO(b'x'))
                if mode=='duplicate': archive.addfile(member,io.BytesIO(b'x'))
        altered = dict(manifest); altered['baselineArchiveSha256']=sha(forged); altered['baselineFiles']={member.name:hashlib.sha256(b'x').hexdigest()}
        (copied/'core-source-manifest.json').write_text(json.dumps(altered))
        destination = root / mode / 'result'
        result = subprocess.run(['python3',str(copied/'prepare-core.py'),str(destination)],capture_output=True,text=True)
        assert result.returncode != 0 and not destination.exists()
        assert not list(destination.parent.glob('.pocket-core-context-*')) and not (root/mode/'escape').exists()
        results.append({'case':'unsafe-archive-'+mode,'rejected':True,'noEscape':True,'scratchRemoved':True})
print(json.dumps(results,indent=2))
