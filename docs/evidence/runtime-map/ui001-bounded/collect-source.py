import datetime, hashlib, json, pathlib, shutil, subprocess, sys

base = pathlib.Path(sys.argv[1])
mode = sys.argv[2]
sha = lambda path: hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
owner = pathlib.Path('docs/final-readiness/execution/cloud/OWNER-UI-001')
original = owner / 'source-manifest-v3.json'
manifest = json.loads(original.read_text())
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
base.mkdir(parents=True, exist_ok=True)
if mode == 'before':
    fixtures = [
        'apps/electron/src/renderer/components/app-shell/__tests__/rox-readiness-ui-001.browser.test.ts',
        'apps/electron/src/renderer/components/app-shell/__tests__/rox-readiness-ui-001.component-harness.ts',
        'apps/electron/src/renderer/components/app-shell/__tests__/terminal-cloudrun-hosts-nav.test.ts',
        'apps/electron/src/renderer/components/app-shell/__tests__/rox-readiness-ui-001.route-recovery.test.ts',
        'apps/electron/src/renderer/components/app-shell/__tests__/rox-readiness-ui-001.service-workspace-recovery.test.ts',
        'apps/electron/src/renderer/contexts/__tests__/rox-readiness-ui-001.navigation-browser.test.ts',
        'docs/final-readiness/execution/cloud/OWNER-UI-001/rox-readiness-ui-001.navigation-browser.ts',
        'docs/final-readiness/execution/cloud/OWNER-UI-001/rox-readiness-ui-001.recovery-browser.ts',
        '.github/workflows/ui-001-recovery.yml', 'bun.lock',
    ]
    actual = {path: sha(path) for path in manifest['sourceSha256']}
    checkout = {path: hashlib.sha256(subprocess.check_output(['git', 'show', 'HEAD:' + path])).hexdigest() for path in actual}
    inputs = {}
    for lane in ['main', 'navigation']:
        path = pathlib.Path(sys.argv[3]) / (lane + '-fixture.js.manifest.json')
        compiled = json.loads(path.read_text())
        assert compiled['sourceRevision'] == head
        assert all(sha(path) == value for path, value in compiled['inputSha256'].items())
        inputs.update(compiled['inputSha256'])
        shutil.copyfile(path, base / (lane + '-fixture.manifest.json'))
    tracked = set(subprocess.check_output(['git', 'ls-files'], text=True).splitlines())
    source_inputs = {path: value for path, value in inputs.items() if path in tracked}
    input_checkout = {path: hashlib.sha256(subprocess.check_output(['git', 'show', 'HEAD:' + path])).hexdigest() for path in source_inputs}
    receipt = {
        'testedRevision': head, 'createdUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'actualSourceSha256': actual, 'checkoutSourceSha256': checkout, 'matchesCheckout': actual == checkout,
        'matchesCommittedCandidate': actual == manifest['sourceSha256'],
        'candidateSourceMismatches': sorted(path for path in actual if actual[path] != manifest['sourceSha256'][path]),
        'fixtureSha256': {path: sha(path) for path in fixtures}, 'bundleInputSha256': inputs,
        'trackedBundleInputsMatchCheckout': source_inputs == input_checkout,
        'historicalManifestSha256': sha(original),
        'qualificationScope': 'bounded local renderer/IPC fixture A,B,C1,C2,D; not full UI-001 workflow, MCP, native/installed/hosted acceptance',
    }
    assert receipt['matchesCheckout'] and receipt['trackedBundleInputsMatchCheckout']
    (base / 'source-before.json').write_text(json.dumps(receipt, indent=2) + '\n')
    shutil.copyfile(original, base / 'historical-source-manifest-v3.json')
    print(json.dumps({'testedRevision': head, 'matchesCheckout': receipt['matchesCheckout'], 'candidateDrift': receipt['candidateSourceMismatches'], 'bundleInputs': len(inputs), 'trackedBundleInputs': len(source_inputs)}, indent=2))
elif mode == 'after':
    before = json.loads((base / 'source-before.json').read_text())
    receipt = {'sourceRevisionAfter': head, 'createdUtc': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    for source, destination, result in [
        ('actualSourceSha256', 'sourceAfterSha256', 'sourcesStable'),
        ('fixtureSha256', 'fixtureAfterSha256', 'fixturesStable'),
        ('bundleInputSha256', 'bundleInputAfterSha256', 'bundleInputsStable'),
    ]:
        receipt[destination] = {path: sha(path) for path in before[source]}
        receipt[result] = receipt[destination] == before[source]
    receipt['historicalManifestUnchanged'] = sha(original) == before['historicalManifestSha256']
    receipt['revisionStable'] = head == before['testedRevision']
    (base / 'source-after.json').write_text(json.dumps(receipt, indent=2) + '\n')
    results = {key: receipt[key] for key in ['sourcesStable', 'fixturesStable', 'bundleInputsStable', 'historicalManifestUnchanged', 'revisionStable']}
    print(json.dumps(results, indent=2))
    assert all(results.values())
else:
    raise ValueError(mode)
