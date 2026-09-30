#!/usr/bin/env python3
"""Revision-bound OMP preflight and explicitly selected implementation workers."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = Path('/Users/t/.agents/runtime')
OMP = Path('/Users/t/.local/bin/omp')
MODEL = 'openai-codex/gpt-6.1-sol'
STATE = Path('/Users/t/.agents/state/rox-compound-70')
sys.path.insert(0, str(RUNTIME))
from harness.contracts import envelope, dispatch_packet, canonical_hash, verify_inputs, input_manifest, revision

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.next')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    os.replace(temporary, path)

def record_for(package):
    name = package['id']
    if package['program'] == 'macro':
        path = 'plans/macro-integration/work-packages.json'
        records = json.loads((ROOT / path).read_text())['workPackages']
    elif package['program'] == 'suite':
        path = 'plans/rox-suite/issues.json'
        records = json.loads((ROOT / path).read_text())['issues']
    else:
        path = 'plans/lark-suite-reference/execution-packages.json'
        records = json.loads((ROOT / path).read_text())['packages']
    matches = [x for x in records if x['id'] == name]
    if len(matches) != 1:
        raise ValueError('Missing unique specification for ' + name)
    return path, matches[0]

def verify(report_path, packet_path):
    report = json.loads(report_path.read_text())
    packet = json.loads(packet_path.read_text())
    for key in ('task_id', 'attempt_id', 'packet_hash', 'input_revision'):
        if report.get(key) != packet[key]:
            raise ValueError('Report lineage mismatch: ' + key)
    for key in ('dependencies', 'ownedNewFiles', 'sharedPatchRequests', 'acceptanceMatrix', 'nextExecutableAction'):
        if key not in report:
            raise ValueError('Missing report field ' + key)
    references = report.get('sourceReferences', [])
    if len(references) < 3:
        raise ValueError('At least three concrete source references required')
    for reference in references:
        path = ROOT / reference['path']
        if not path.resolve().is_relative_to(ROOT) or not path.is_file():
            raise ValueError('Invalid source path')
        if not reference.get('symbol') or not reference.get('sha256'):
            raise ValueError('Symbol and whole-file digest required')
        if digest(path) != reference['sha256']:
            raise ValueError('Source changed after inspection: ' + reference['path'])
    if report.get('featureComplete') is not False:
        raise ValueError('Preflight must not claim feature completion')
    return {'validPreflight': True, 'featureComplete': False, 'references': len(references)}

def preflight_selection(count, offset=0):
    if not 1 <= count <= 70:
        raise ValueError('Pool count must be between 1 and 70')
    if offset < 0:
        raise ValueError('Preflight offset must be nonnegative')
    packages = json.loads((ROOT / 'plans/compound-implementation/progress.json').read_text())['packages']
    active = {'LSX-WP-001', 'LSX-WP-003', 'LSX-WP-005', 'LSX-WP-006', 'CI-001', 'RS-FOCUS-01'}
    first = ['WP-01', 'WP-48', 'RS-ADM-01', 'RS-AUT-01', 'RS-DRV-01', 'RS-MSG-01', 'RS-MTG-01']
    order = first + [p['id'] for p in packages if p['id'] not in first and p['id'] not in active]
    index = {p['id']: p for p in packages}
    if offset + count > len(order):
        raise ValueError(f'Preflight range [{offset}, {offset + count}) exceeds {len(order)} eligible packages')
    return [index[identifier] for identifier in order[offset:offset + count]]


def run(count, offset=0):
    selected = preflight_selection(count, offset)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    run_id = 'rox-compound-' + stamp
    run_dir = STATE / run_id
    run_dir.mkdir(parents=True)
    jobs = []
    for package in selected:
        identifier = package['id']
        spec_path, spec_record = record_for(package)
        directory = run_dir / identifier
        directory.mkdir()
        output = f'plans/compound-implementation/worker-reviews/{identifier}.json'
        spec_paths = [spec_path]
        if package['program'] == 'suite':
            spec_paths.append(spec_record['publishedSpec']['path'])
        if spec_record.get('sourceRecord'):
            spec_paths.append(spec_record['sourceRecord']['path'])
        contract = envelope(objective='Inspect the exact implementation seams and full DoD for ' + identifier,
            cwd=str(ROOT), acceptance=['Source-backed package preflight with exact new files, shared patches, dependencies and per-criterion acceptance; no implementation or completion claim.'],
            mode='inspect', request_id=run_id, independent_units=count, durable=True,
            allowed_operations=['read', 'write-artifact'], inputs=spec_paths,
            delivery='owned preflight report; root retains all source integration')
        packet = dispatch_packet(contract, {'id': identifier + '-preflight', 'owner': 'omp-' + run_id + '-' + identifier,
            'role': 'research', 'owned_paths': [output], 'outputs': [output],
            'depends_on': [], 'verification_argv': [sys.executable, str(Path(__file__).resolve()), '--verify', output, str(directory / 'packet.json')]}, client='omp')
        write_json(directory / 'contract.json', contract)
        write_json(directory / 'packet.json', packet)
        instructions = f'''You are an authorized independent coding preflight worker for package {identifier}.
Use GPT 6.1 Sol high reasoning. Repository: {ROOT}; input HEAD {packet['input_revision']}.
Read AGENTS.md and the exact specification record below. The working tree contains root-owned uncommitted wave0 work. Do not change any product source, tests, manifests, progress, shared file, or Git state. Do not run builds, tests, native UI or network operations. You own ONLY {output}; create that JSON using write tool. No questions.
Implementations must start in dependency order, after the lead's wave0 commit and accepted dependency receipts. This task prepares exact code-level contributions and integration requests while that work finishes. Do not pretend this is feature implementation.
Inspect actual existing code through read/grep/find. Limit inspection to this package's paths and their direct imports. Preserve existing mechanisms; no second stores or surfaces. For every DoD criterion give the actual symbol/seam, proposed precise change, verification and missing prerequisite. Identify surprising hidden foundation gates in published specification separately from explicit DAG edges. For a shared file propose exact patch request (path/symbol/change/reason) without writing it. Source digest can be obtained with the bash tool using shasum -a 256 of the concrete inspected file (read-only). No bash mutations.
Output a single JSON object at {output}, containing:
task_id={json.dumps(packet['task_id'])}, attempt_id={json.dumps(packet['attempt_id'])}, packet_hash={json.dumps(packet['packet_hash'])}, input_revision={json.dumps(packet['input_revision'])}, packageId={json.dumps(identifier)}, featureComplete=false;
dependencies (the exact explicit array), foundationGates (separate), ownedNewFiles (only normative new files), sharedPatchRequests (path/symbol/change/reason), acceptanceMatrix (criterion/currentEvidence/requiredChange/verification/state), sourceReferences (at least three actual path/symbol/lineStart/lineEnd/sha256 whole file), nextExecutableAction and risks.
All evidence must be from actual code/specifications. Do not weaken acceptance or turn unimplemented requirements into N/A. Existing source may change during root integration: record inspected whole-file hashes and state stale evidence honestly. Return report path and concise findings.

Dispatch packet:
{json.dumps(packet, ensure_ascii=False)}
Exact progress entry:
{json.dumps(package, ensure_ascii=False)}
Normative record ({spec_path}):
{json.dumps(spec_record, ensure_ascii=False)}
'''
        prompt_path = directory / 'prompt.txt'
        prompt_path.write_text(instructions)
        log = (directory / 'events.jsonl').open('wb')
        argv = [str(OMP), '--model', MODEL, '--thinking', 'high', '--no-extensions', '--no-skills', '--no-title',
            '--no-lsp', '--no-pty', '--approval-mode', 'yolo', '--mode', 'json', '--session-dir', str(directory / 'sessions'),
            '--max-time', '45m', '-p', '@' + str(prompt_path)]
        process = subprocess.Popen(argv, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        job = {'packageId': identifier, 'pid': process.pid, 'state': 'PROCESS_STARTED_SESSION_PENDING',
            'directory': str(directory), 'packetHash': packet['packet_hash'], 'output': output,
            'model': MODEL, 'inputRevision': packet['input_revision']}
        jobs.append((process, log, job))
        write_json(run_dir / 'launch.json', {'runId': run_id, 'supervisorPid': os.getpid(), 'requested': count, 'offset': offset,
            'started': len(jobs), 'phase': 'SOURCE_PREFLIGHT_ONLY', 'jobs': [j for _, _, j in jobs]})
    print(json.dumps({'runId': run_id, 'workersStarted': len(jobs), 'supervisorPid': os.getpid(), 'receipt': str(run_dir / 'launch.json')}), flush=True)
    while any(process.poll() is None for process, _, _ in jobs):
        for process, log, job in jobs:
            events = Path(job['directory']) / 'events.jsonl'
            if events.stat().st_size:
                with events.open() as stream:
                    for line in stream:
                        try:
                            event = json.loads(line)
                        except ValueError:
                            continue
                        if event.get('type') == 'session':
                            job['sessionId'] = event['id']
                            break
            code = process.poll()
            job['state'] = 'RUNNING' if code is None else 'PROCESS_EXITED'
            if code is not None:
                job['exitCode'] = code
        write_json(run_dir / 'launch.json', {'runId': run_id, 'supervisorPid': os.getpid(), 'requested': count, 'offset': offset,
            'started': len(jobs), 'phase': 'SOURCE_PREFLIGHT_ONLY', 'jobs': [j for _, _, j in jobs]})
        time.sleep(10)
    for process, log, job in jobs:
        log.close()
        try:
            job['preflightVerification'] = verify(ROOT / job['output'], Path(job['directory']) / 'packet.json')
        except (OSError, ValueError, KeyError) as error:
            job['preflightVerification'] = {'validPreflight': False, 'reason': str(error)}
    write_json(run_dir / 'launch.json', {'runId': run_id, 'supervisorPid': os.getpid(), 'requested': count, 'offset': offset,
        'started': len(jobs), 'phase': 'PREFLIGHT_PROCESSES_FINISHED', 'jobs': [j for _, _, j in jobs]})

def repository_path(raw):
    """Reject broad ownership, traversal, symlinks outside the checkout and aliases."""
    path = Path(raw)
    if (not isinstance(raw, str) or not raw or path.is_absolute() or '..' in path.parts
            or raw != path.as_posix() or path.as_posix() == '.'):
        raise ValueError('Explicit repository-relative file required: ' + str(raw))
    target = ROOT / path
    if not target.resolve().is_relative_to(ROOT):
        raise ValueError('Path escapes checkout: ' + raw)
    if target.is_dir():
        raise ValueError('Directory ownership is forbidden: ' + raw)
    return raw


def normative_new_files(package, record):
    """Read normative ownership, including compact published Suite path notation."""
    if record.get('newFiles') is not None or record.get('proposed_new_files') is not None:
        paths = record.get('newFiles', record.get('proposed_new_files'))
    elif package['program'] == 'suite':
        paths = []
        in_new = False
        for line in (ROOT / record['publishedSpec']['path']).read_text().splitlines():
            if line.startswith('## ') or line.startswith('**EXTEND'):
                in_new = False
            if (line.startswith('**NEW предлагаемые файлы**')
                    or line.startswith('Proposed NEW paths')
                    or line.startswith('## Предлагаемые новые файлы')):
                in_new = True
                continue
            if in_new:
                match = re.match(r'- `([^`]+)`', line)
                if match:
                    paths.append(match.group(1))
            # Published DRV/MSG specs use this exact compact renderer path notation.
            match = re.search(r'(?:Proposed|New proposed) components/(\w+)/\{([^}]+)\}\.tsx', line)
            if match:
                paths.extend('apps/electron/src/renderer/components/' + match.group(1)
                             + '/' + name + '.tsx' for name in match.group(2).split(','))
            match = re.search(r'Proposed (tests/[\w/.-]+)(?: and ([\w.-]+))?\.', line)
            if match:
                paths.append(match.group(1))
                if match.group(2):
                    paths.append(str(Path(match.group(1)).parent / match.group(2)))
    else:
        raise ValueError('No supported normative new-file allocation for ' + package['id'])
    if not isinstance(paths, list) or not paths or any(not isinstance(p, str) for p in paths):
        raise ValueError('Normative new files are required for ' + package['id'])
    paths = [repository_path(p) for p in paths]
    if len(paths) != len(set(paths)):
        raise ValueError('Duplicate normative path for ' + package['id'])
    return paths


def dependency_inputs(package, receipts, expected_revision):
    """Require root integration evidence, never treat a preflight as a predecessor."""
    inputs = []
    for identifier in package['dependencies']:
        if identifier not in receipts:
            raise ValueError('Current root integration receipt required for dependency ' + identifier)
        path = repository_path(receipts[identifier])
        receipt = json.loads((ROOT / path).read_text())
        if (receipt.get('packageId') != identifier or receipt.get('inputRevision') != expected_revision
                or receipt.get('state') != 'ROOT_VERIFIED_INTEGRATED'
                or not receipt.get('evidence') or not receipt.get('artifacts')):
            raise ValueError('Dependency has no current verified integration evidence: ' + identifier)
        for item in receipt['evidence'] + receipt['artifacts']:
            name = repository_path(item['path'])
            if not (ROOT / name).is_file() or digest(ROOT / name) != item.get('sha256'):
                raise ValueError('Dependency evidence/source drift: ' + name)
            inputs.append(name)
        inputs.append(path)
    return inputs


def implementation_prompt(package, record, packet, binding, directory):
    postgres = ('Root provisioned a real PostgreSQL 17.11 instance at 127.0.0.1:54379, database rox_compound_wp01. '
        'Connection values are in /Users/t/.agents/state/rox-compound-workspace/postgres-environment.json. '
        'Read them only inside a test loader; never print, embed in source/report, or copy secrets. '
        'Use isolated package-specific test tables/transactions and clean up only your own test data. '
        'Root owns missing authority-bootstrap/issuer/transport integration files: return exact creation patches for them. '
        'This provisioned loopback PostgreSQL test connection is your sole exception to the network restriction.\n'
        if package['id'] == 'WP-01' else '')
    return f'''You are an authorized implementation worker for {package['id']}.
Model: GPT 6.1 Sol; reasoning high. Repository {ROOT}; input revision {packet['input_revision']}.
Read AGENTS.md, packet.json, implementation-binding.json and the normative specification files before editing.
Your ONLY writable repository files are the exact packet owned_paths, all absent when assigned.
Never modify any other existing or new repository file. Even an existing normative proposed-new file belongs to root.
You may write your report, exact unified patches and test logs ONLY inside your external task directory {directory}.
For every existing shared file, produce a complete unified diff in {directory}/patches/, with repository-relative a/ and b/ paths, and record its target current SHA256. Root applies it and owns integration. Do not apply these patches yourself.
No Git writes/commits/push, install/update, build, broad typecheck, UI/browser/native app, networking, external side effects, global config or resources. Do not spawn more workers. Read-only shell commands are allowed. You may run only this package's narrowly scoped tests using the existing Bun installation; capture argv, result and logs outside the repository. Do not run a full suite or start a server.
{postgres}
Implement real source plus meaningful behavioral tests for the assigned mechanisms. Do not return only a report, plan, placeholder, TODO-only module, canned success result or disconnected mock screen. The report accompanies source and tests. Preserve current stores, actor/permission contracts, identity, commands, persistence and recovery. Every imported seam must actually exist at the assigned generation. Read current source: old preflight evidence may be stale.
Dependencies and foundation gates differ. Use real current predecessor seams when implemented. If a required shared seam is absent, propose its precise root-owned implementation patch at the current generation; never invent a fallback, parallel authority or API and portray it as working. Record the exact blocked integration or external prerequisite, retain implementable work and tests, and keep all full DoD requirements open until root verifies them.
Source generation hashes in packet.input_manifest bind immutable inspected inputs. Newly owned outputs are deliberately absent from that manifest. Check the input revision and hashes before starting and report any drift; do not silently adopt a new generation. Other workers have disjoint ownership. A policy boundary is not an OS sandbox.
Root may commit independent files while you work. Keep the original packet/input_revision unchanged. At handoff only a verified descendant HEAD with every bound input/source byte unchanged can remain compatible; any source drift or rewritten ancestry is rejected. This does not relax initial preparation/launch revision checks.
Write {directory}/implementation-report.json with exact packet task_id, attempt_id, packet_hash, input_revision and request_revision; packageId; featureComplete=false; state=IMPLEMENTED_PENDING_ROOT_INTEGRATION or BLOCKED_ON_FOUNDATION; dependencies equal the progress array; artifacts=[{{path,sha256}}] for every produced owned file; sharedPatchRequests=[{{path,baseSha256,patchPath,reason}}]; tests=[{{argv,exitCode,logPath,logSha256,state}}]; acceptanceMatrix=[{{criterion,mechanismEvidence,integrationNeeded,verification,state}}]; sourceReferences=[{{path,symbol,sha256}}]; remainingGates and nextExecutableAction.
patchPath/logPath must point inside your external task directory. All artifacts/references need actual SHA256, not invented hashes. Tests must exercise behavior and a relevant failure path; if unavailable, mark NOT_RUN with exact prerequisite. Never claim root integration, full UI/native/provider verification, feature completion or issue closure. Include every produced file; every missing normative output remains a gate.
Finish with paths to source, tests, patches and report plus concise concrete findings.

Dispatch packet:
{json.dumps(packet, ensure_ascii=False)}
Generation and ownership binding:
{json.dumps(binding, ensure_ascii=False)}
Exact progress entry:
{json.dumps(package, ensure_ascii=False)}
Normative record:
{json.dumps(record, ensure_ascii=False)}
'''


def prepare_implementation(identifiers, expected_revision, receipt_map, run_dir):
    if not identifiers or len(identifiers) != len(set(identifiers)) or len(identifiers) > 70:
        raise ValueError('Select 1–70 distinct explicit package IDs')
    if not re.fullmatch(r'[0-9a-f]{40}', expected_revision or ''):
        raise ValueError('--expected-revision requires the full committed input SHA')
    progress = json.loads((ROOT / 'plans/compound-implementation/progress.json').read_text())
    index = {p['id']: p for p in progress['packages']}
    unknown = set(identifiers) - set(index)
    if unknown:
        raise ValueError('Unknown package IDs: ' + ', '.join(sorted(unknown)))
    prepared = []
    all_owned = set()
    run_id = run_dir.name
    for identifier in identifiers:
        package = index[identifier]
        spec_path, record = record_for(package)
        normative = normative_new_files(package, record)
        owned = [p for p in normative if not (ROOT / p).exists()]
        existing = [p for p in normative if (ROOT / p).exists()]
        if all_owned.intersection(owned):
            raise ValueError('Overlapping normative ownership: ' + identifier)
        all_owned.update(owned)
        if not owned:
            raise ValueError('No absent normative output; root must allocate a new implementation task for ' + identifier)
        review_path = package.get('preflightReport')
        if not review_path:
            raise ValueError('Source preflight required for ' + identifier)
        review_path = repository_path(review_path)
        review = json.loads((ROOT / review_path).read_text())
        if review.get('packageId') != identifier or review.get('featureComplete') is not False:
            raise ValueError('Invalid preflight identity/completion boundary: ' + identifier)
        inputs = ['AGENTS.md', 'plans/compound-implementation/launch-worker-pool.py',
                  'plans/compound-implementation/implementation-pool-contract.md', spec_path, review_path]
        if package['program'] == 'suite':
            inputs.append(record['publishedSpec']['path'])
        if record.get('sourceRecord'):
            inputs.append(record['sourceRecord']['path'])
        inputs += [repository_path(r['path']) for r in review['sourceReferences']]
        inputs += existing
        inputs += dependency_inputs(package, receipt_map, expected_revision)
        # Never hash implementation outputs as immutable source inputs.
        inputs = sorted(set(inputs) - set(owned))
        directory = run_dir / identifier
        contract = envelope(objective='Implement source and meaningful tests for ' + identifier + ' at the bound generation',
            cwd=str(ROOT), acceptance=['Real mechanisms and behavioral tests in normative new files; exact unapplied patches for existing files; source-bound handoff with open integration/full DoD gates.'],
            mode='execute', request_id=run_id, independent_units=len(identifiers), durable=True,
            allowed_operations=['read', 'write-artifact', 'write-owned-source', 'run-scoped-tests'], inputs=inputs,
            delivery='new source and tests; external taskdir patches/report; root verifies and integrates')
        if contract['input_revision'] != expected_revision:
            raise ValueError('Checkout HEAD differs from --expected-revision')
        packet = dispatch_packet(contract, {'id': identifier + '-implementation',
            'owner': 'omp-' + run_id + '-' + identifier, 'role': 'implementer', 'owned_paths': owned,
            'outputs': owned, 'depends_on': package['dependencies'],
            'operations': ['read', 'write-artifact', 'write-owned-source', 'run-scoped-tests'],
            'verification_argv': [sys.executable, str(Path(__file__).resolve()), '--verify-implementation', str(directory)]}, client='omp')
        binding = {'schemaVersion': 1, 'phase': 'IMPLEMENTATION', 'packageId': identifier,
            'model': MODEL, 'reasoning': 'high', 'packetHash': packet['packet_hash'],
            'inputRevision': expected_revision, 'taskDirectory': str(directory),
            'progressEntry': package, 'progressEntrySha256': canonical_hash(package),
            'normativeRecordSha256': canonical_hash(record), 'normativeNewFiles': normative,
            'rootOwnedExistingNormativeFiles': existing, 'sourceGenerations': packet['input_manifest'],
            'preflightEvidenceIsHistorical': True, 'featureComplete': False,
            'report': str(directory / 'implementation-report.json'),
            'verificationScope': 'handoff lineage, source generation, paths and hashes only; root independently verifies behavior and full DoD'}
        prepared.append((directory, contract, packet, binding, implementation_prompt(package, record, packet, binding, directory)))
    # Validate every package before leaving any prepared task artifact.
    run_dir.mkdir(parents=True, exist_ok=False)
    for directory, contract, packet, binding, prompt in prepared:
        directory.mkdir()
        (directory / 'patches').mkdir()
        write_json(directory / 'contract.json', contract)
        write_json(directory / 'packet.json', packet)
        write_json(directory / 'implementation-binding.json', binding)
        (directory / 'prompt.txt').write_text(prompt)
    return prepared


def external_file(directory, raw):
    path = Path(raw)
    if not path.is_absolute():
        path = directory / path
    if not path.resolve().is_relative_to(directory.resolve()) or not path.is_file():
        raise ValueError('Missing artifact or artifact outside task directory: ' + raw)
    return path


def verify_handoff_generation(packet):
    """Keep the original packet; permit only unchanged inputs on descendant HEAD."""
    current_inputs = input_manifest(packet['cwd'], [item['path'] for item in packet['input_manifest']])
    if current_inputs != packet['input_manifest']:
        raise ValueError('Input artifacts changed since dispatch')
    original = packet['input_revision']
    current = revision(packet['cwd'])
    if not original or not current:
        raise ValueError('Committed input and current revisions required for implementation handoff')
    argv = ['git', '-C', packet['cwd'], 'merge-base', '--is-ancestor', original, current]
    checked = subprocess.run(argv, capture_output=True)
    if checked.returncode != 0:
        raise ValueError('Current HEAD is not a verified descendant of the input revision')
    return {'inputRevision': original, 'currentRevision': current, 'generationAdvanced': current != original,
            'ancestryVerification': {'argv': argv, 'exitCode': checked.returncode,
                'relation': 'DESCENDANT' if current != original else 'SAME_REVISION',
                'stdoutSha256': hashlib.sha256(checked.stdout).hexdigest(),
                'stderrSha256': hashlib.sha256(checked.stderr).hexdigest()},
            'inputManifestVerified': True}


def verify_implementation(directory):
    directory = directory.resolve()
    packet = json.loads((directory / 'packet.json').read_text())
    binding = json.loads((directory / 'implementation-binding.json').read_text())
    report = json.loads((directory / 'implementation-report.json').read_text())
    if canonical_hash({k: v for k, v in packet.items() if k != 'packet_hash'}) != packet['packet_hash']:
        raise ValueError('Dispatch packet hash mismatch')
    for key in ('task_id', 'attempt_id', 'packet_hash', 'input_revision', 'request_revision'):
        if report.get(key) != packet[key]:
            raise ValueError('Report lineage mismatch: ' + key)
    if (binding['packetHash'] != packet['packet_hash'] or binding['sourceGenerations'] != packet['input_manifest']
            or binding['inputRevision'] != packet['input_revision']
            or report.get('packageId') != binding['packageId']):
        raise ValueError('Implementation binding mismatch')
    if report.get('featureComplete') is not False or report.get('state') not in (
            'IMPLEMENTED_PENDING_ROOT_INTEGRATION', 'BLOCKED_ON_FOUNDATION'):
        raise ValueError('Worker cannot claim feature completion/integration')
    generation = verify_handoff_generation(packet)
    spec_path, record = record_for(binding['progressEntry'])
    if canonical_hash(record) != binding['normativeRecordSha256']:
        raise ValueError('Normative source generation changed')
    progress = json.loads((ROOT / 'plans/compound-implementation/progress.json').read_text())['packages']
    current = next(p for p in progress if p['id'] == binding['packageId'])
    # Operational progress updates are not new source generations; DAG/spec changes are.
    for key in ('program', 'spec', 'dependencies'):
        if current.get(key) != binding['progressEntry'].get(key):
            raise ValueError('Package source/DAG changed: ' + key)
    if report.get('dependencies') != packet['depends_on']:
        raise ValueError('Dependency mismatch')
    for key in ('sharedPatchRequests', 'tests', 'acceptanceMatrix', 'sourceReferences', 'remainingGates', 'nextExecutableAction'):
        if key not in report:
            raise ValueError('Missing implementation report field: ' + key)
    artifacts = report.get('artifacts', [])
    names = [a['path'] for a in artifacts]
    if len(names) != len(set(names)) or set(names) - set(packet['owned_paths']):
        raise ValueError('Returned artifact exceeds exact normative ownership')
    for artifact in artifacts:
        name = repository_path(artifact['path'])
        if not (ROOT / name).is_file() or digest(ROOT / name) != artifact.get('sha256'):
            raise ValueError('Returned artifact missing or digest mismatch: ' + name)
    if report['state'] == 'IMPLEMENTED_PENDING_ROOT_INTEGRATION' and set(names) != set(packet['outputs']):
        raise ValueError('Implementation handoff omitted a normative output')
    source_hashes = {s['path']: s['sha256'] for s in packet['input_manifest']}
    def source_hash(name):
        if name in packet['owned_paths']:
            raise ValueError('Owned output cannot be an immutable source input: ' + name)
        if name not in source_hashes:
            # Direct imports discovered after dispatch remain bound to the committed generation.
            result = subprocess.run(['git', '-C', str(ROOT), 'show', packet['input_revision'] + ':' + name], capture_output=True)
            if result.returncode != 0:
                raise ValueError('Additional existing source is absent from the bound revision: ' + name)
            expected = hashlib.sha256(result.stdout).hexdigest()
            if not (ROOT / name).is_file() or digest(ROOT / name) != expected:
                raise ValueError('Additional inspected source drift: ' + name)
            source_hashes[name] = expected
        return source_hashes[name]
    patch_hashes = []
    for request in report['sharedPatchRequests']:
        name = repository_path(request['path'])
        if name in packet['owned_paths']:
            raise ValueError('Owned outputs must be written directly, not returned as shared patches: ' + name)
        new_target = request.get('baseSha256') is None and not (ROOT / name).exists()
        if not new_target and request.get('baseSha256') != source_hash(name):
            raise ValueError('Shared patch base source generation mismatch: ' + name)
        patch = external_file(directory, request['patchPath'])
        content = patch.read_text()
        old = re.findall(r'^--- a/(.+)$', content, re.MULTILINE)
        new = re.findall(r'^\+\+\+ b/(.+)$', content, re.MULTILINE)
        old_valid = (old == [] and len(re.findall(r'^--- /dev/null$', content, re.MULTILINE)) == 1) if new_target else old == [name]
        if not old_valid or new != [name] or not re.search(r'^@@ ', content, re.MULTILINE):
            raise ValueError('Exact single existing-file unified patch required: ' + name)
        patch_hashes.append({'path': str(patch), 'sha256': digest(patch)})
    for reference in report['sourceReferences']:
        name = repository_path(reference['path'])
        if not reference.get('symbol') or reference.get('sha256') != source_hash(name):
            raise ValueError('Unbound or changed source reference: ' + name)
    for test in report['tests']:
        if test.get('state') == 'NOT_RUN':
            if not test.get('prerequisite'):
                raise ValueError('NOT_RUN test needs an exact prerequisite')
            continue
        log = external_file(directory, test['logPath'])
        if not isinstance(test.get('argv'), list) or not test['argv'] or digest(log) != test.get('logSha256'):
            raise ValueError('Test command/log evidence is invalid')
        if type(test.get('exitCode')) is not int:
            raise ValueError('Actual test exit code required')
    if not report['acceptanceMatrix'] or not report['nextExecutableAction'] or not report['remainingGates']:
        raise ValueError('Explicit acceptance and remaining integration gates required')
    # Recheck generation after reading all artifacts; additional references stay bound to original bytes.
    generation = verify_handoff_generation(packet)
    for name, expected in source_hashes.items():
        if not (ROOT / name).is_file() or digest(ROOT / name) != expected:
            raise ValueError('Inspected source changed during verification: ' + name)
    return {'validImplementationHandoff': True, 'behaviorVerified': False, 'featureComplete': False,
            **generation,
            'packageId': binding['packageId'], 'artifacts': artifacts, 'patches': patch_hashes,
            'missingNormativeOutputs': sorted(set(packet['outputs']) - set(names)),
            'scope': binding['verificationScope']}


def implementation_run(identifiers, expected_revision, receipts, prepare_only=False):
    run_id = 'rox-compound-implementation-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    run_dir = STATE / run_id
    prepared = prepare_implementation(identifiers, expected_revision, receipts, run_dir)
    jobs = []
    receipt = {'runId': run_id, 'supervisorPid': os.getpid(), 'requested': len(identifiers),
        'started': 0, 'phase': 'IMPLEMENTATION_PREPARED', 'model': MODEL, 'reasoning': 'high',
        'inputRevision': expected_revision, 'featureComplete': False, 'jobs': []}
    for directory, contract, packet, binding, prompt in prepared:
        job = {'packageId': binding['packageId'], 'state': 'PREPARED_NOT_STARTED', 'directory': str(directory),
            'packetHash': packet['packet_hash'], 'output': binding['report'], 'model': MODEL, 'reasoning': 'high',
            'inputRevision': packet['input_revision'], 'ownedPaths': packet['owned_paths'], 'featureComplete': False}
        receipt['jobs'].append(job)
    write_json(run_dir / 'launch.json', receipt)
    if prepare_only:
        print(json.dumps({'runId': run_id, 'workersStarted': 0, 'prepared': len(prepared), 'receipt': str(run_dir / 'launch.json')}), flush=True)
        return
    # A preparation receipt alone never starts a process or proves a native session.
    for item, job in zip(prepared, receipt['jobs']):
        directory, contract, packet, binding, prompt = item
        verify_inputs(packet)
        if any((ROOT / p).exists() for p in packet['owned_paths']):
            raise ValueError('Ownership changed between preparation and launch: ' + binding['packageId'])
        log = (directory / 'events.jsonl').open('wb')
        argv = [str(OMP), '--model', MODEL, '--thinking', 'high', '--no-extensions', '--no-skills', '--no-title',
            '--no-lsp', '--no-pty', '--approval-mode', 'yolo', '--mode', 'json', '--session-dir', str(directory / 'sessions'),
            '--max-time', '90m', '-p', '@' + str(directory / 'prompt.txt')]
        process = subprocess.Popen(argv, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        job.update({'pid': process.pid, 'state': 'PROCESS_STARTED_SESSION_PENDING', 'argv': argv})
        jobs.append((process, log, job))
        receipt.update({'started': len(jobs), 'phase': 'IMPLEMENTATION_PROCESSES_STARTED'})
        write_json(run_dir / 'launch.json', receipt)
    print(json.dumps({'runId': run_id, 'workersStarted': len(jobs), 'supervisorPid': os.getpid(), 'receipt': str(run_dir / 'launch.json')}), flush=True)
    while True:
        running = False
        for process, log, job in jobs:
            with (Path(job['directory']) / 'events.jsonl').open() as stream:
                for line in stream:
                    try:
                        event = json.loads(line)
                    except ValueError:
                        continue
                    if event.get('type') == 'session':
                        job['sessionId'] = event['id']
                        break
            code = process.poll()
            job['state'] = 'RUNNING' if code is None else 'PROCESS_EXITED'
            running |= code is None
            if code is not None:
                job['exitCode'] = code
        write_json(run_dir / 'launch.json', receipt)
        if not running:
            break
        time.sleep(10)
    for process, log, job in jobs:
        log.close()
        try:
            job['implementationHandoffVerification'] = verify_implementation(Path(job['directory']))
        except (OSError, ValueError, KeyError, StopIteration) as error:
            job['implementationHandoffVerification'] = {'validImplementationHandoff': False, 'featureComplete': False, 'reason': str(error)}
    receipt['phase'] = 'IMPLEMENTATION_PROCESSES_FINISHED_PENDING_ROOT_VERIFICATION'
    write_json(run_dir / 'launch.json', receipt)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', choices=('preflight', 'implementation'), default='preflight')
    parser.add_argument('--count', type=int, default=70, help='Preflight pool size; unchanged default 70')
    parser.add_argument('--offset', type=int, default=0, help='Preflight range offset in the stable eligible-package ordering')
    parser.add_argument('--ids', nargs='+', help='Explicit implementation package IDs; no automatic expansion')
    parser.add_argument('--expected-revision', help='Full committed input SHA required for implementation')
    parser.add_argument('--dependency-receipt', action='append', default=[], metavar='ID=PATH', help='Root-verified current dependency receipt; repeat as needed')
    parser.add_argument('--prepare-only', action='store_true', help='Validate and write external implementation packets without runtime jobs')
    parser.add_argument('--verify', nargs=2, metavar=('REPORT', 'PACKET'), help='Existing preflight verifier')
    parser.add_argument('--verify-implementation', metavar='TASK_DIRECTORY', help='Validate an implementation handoff; never feature completion')
    args = parser.parse_args()
    try:
        if args.verify:
            print(json.dumps(verify(ROOT / args.verify[0], Path(args.verify[1]))))
        elif args.verify_implementation:
            print(json.dumps(verify_implementation(Path(args.verify_implementation))))
        elif args.phase == 'implementation':
            if args.offset:
                parser.error('--offset applies only to preflight')
            receipts = {}
            for raw in args.dependency_receipt:
                identifier, separator, path = raw.partition('=')
                if not separator or not identifier or not path or identifier in receipts:
                    raise ValueError('--dependency-receipt needs distinct ID=PATH values')
                receipts[identifier] = path
            implementation_run(args.ids, args.expected_revision, receipts, args.prepare_only)
        elif args.ids or args.expected_revision or args.dependency_receipt or args.prepare_only:
            parser.error('Implementation selectors require --phase implementation')
        else:
            run(args.count, args.offset)
    except (OSError, ValueError, KeyError, StopIteration) as error:
        parser.exit(2, str(error) + '\n')
