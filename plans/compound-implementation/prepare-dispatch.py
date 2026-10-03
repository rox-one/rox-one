#!/usr/bin/env python3
"""Prepare ROX's revision-bound local Harness graph; never submit it.

Examples (all preparation is local):
  python3 plans/compound-implementation/prepare-dispatch.py --output /tmp/rox-dag.json
  python3 plans/compound-implementation/prepare-dispatch.py --self-test
  python3 plans/compound-implementation/prepare-dispatch.py verify-unit --package CI-001

After the integration owner commits the implementation baseline, materialize
immutable task packs with --implementation-revision FULL_SHA --materialize DIR.
Preparation never launches a job. The internal run-native producer is invoked
only by a separately submitted Scheduler task. An unresolved gate exits 78.
--gate-map accepts caller-owned *real Harness command criteria*. Its template
is in the dry-run result; missing commands never turn into file-existence or
invented UI checks. Supplying commands is a lead review decision, not a claim
that compilation or a library unit test proves the full product definition of
done. Gate evidence is independently rerun using harness.verification.evaluate.

Only implementation workers own the original allowedWritePaths. The lead owns
shared integration and supplies its acceptance commands separately. Harness
has no passive human-approval node: these lead nodes are read-only executable
gates, and fail until the lead's actual integration/consumer checks are ready.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import sqlite3
import subprocess
import sys
import tempfile

SOURCE_REVISION = "242492868a11b4d9af1c1011f20b31a346875f0a"
SOURCE_ROOT = "plans/lark-suite-reference"
SCRIPT_PATH = "plans/compound-implementation/prepare-dispatch.py"
UNRESOLVED_EXIT = 78


def sha(data):
    return hashlib.sha256(data).hexdigest()


def compact(value):
    # The delivery publisher hashes JavaScript JSON.stringify(packageFiles).
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def git(root, *args):
    result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, timeout=30)
    if result.returncode:
        raise ValueError("git " + " ".join(args[:2]) + ": " + result.stderr.decode().strip())
    return result.stdout


def pointer(value, path):
    for key in path.split("/")[1:]:
        key = key.replace("~1", "/").replace("~0", "~")
        value = value[int(key)] if isinstance(value, list) else value[key]
    return value


def load_harness(runtime):
    runtime = Path(runtime).expanduser().resolve()
    sys.path.insert(0, str(runtime))
    from harness.contracts import envelope, dispatch_packet, relative_path, canonical_hash, verify_inputs
    from harness.scheduler import Scheduler
    from harness.verification import validate_criteria, evaluate
    # No Store/Scheduler initializer is called: both create global runtime state.
    return {
        "envelope": envelope, "dispatch_packet": dispatch_packet,
        "relative_path": relative_path, "canonical_hash": canonical_hash,
        "verify_inputs": verify_inputs,
        "normalize": Scheduler.__new__(Scheduler)._normalize,
        "validate_criteria": validate_criteria, "evaluate": evaluate,
        "hashes": {name: sha((runtime / name).read_bytes()) for name in (
            "harness/contracts.py", "harness/scheduler.py", "harness/verification.py",
            "harness/planning.py", "harness_agent.py")},
        "runtime": str(runtime),
    }


def runtime_models(home):
    database = Path(home).expanduser().resolve() / ".agents/state/journal.sqlite3"
    if not database.is_file():
        return {"contextLimit": 32000, "implementer": None, "state": "NO_RUNTIME_DATABASE"}
    # mode=ro avoids Store's DDL, WAL and directory/config mutations.
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as db:
        row = db.execute("SELECT value FROM kv WHERE namespace=? AND key=?", ("models", "config")).fetchone()
    models = json.loads(row[0]) if row else {}
    return {"contextLimit": models.get("worker_context_max_chars", 32000),
            "implementer": models.get("role_runners", {}).get("implementer", models.get("worker_runner")),
            "state": "PROFILE_OBSERVED_OPERATION_NOT_PROBED"}


PINNED_MODEL = "openai-codex/gpt-6.1-sol"


def request_runner(runner, model):
    """Clone an observed runner for this request only; never change global profiles."""
    if model != PINNED_MODEL:
        raise ValueError("This continuation requires exact openai-codex/gpt-6.1-sol")
    if not isinstance(runner, dict) or runner.get("adapter") != "omp":
        raise ValueError("No supported explicit-model runner for this request")
    selected = dict(runner)
    selected["model"] = model if selected["adapter"] == "omp" else "gpt-6.1-sol"
    return selected


def verify_omp_model_events(stdout):
    messages = []
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        message = event.get("message", {}) if isinstance(event, dict) else {}
        if event.get("type") == "message_end" and message.get("role") == "assistant":
            messages.append(message)
    if not messages or any(message.get("provider") != "openai-codex" or message.get("model") != "gpt-6.1-sol" for message in messages):
        raise ValueError("Actual OMP model events do not prove exact GPT-6.1 Sol; reject native result")
    return len(messages)


def execute_pinned_native(runtime, home, task_path, workspace, attempt_dir, model):
    """Use installed execute/native_call with a request-local config read view."""
    sys.path.insert(0, str(Path(runtime).resolve()))
    from harness.store import Store, redact
    from harness.planning import execute
    task = json.loads(Path(task_path).read_text())
    role = task.get("role")
    class RequestModelStore(Store):
        def get(self, namespace, key, default=None):
            value = super().get(namespace, key, default)
            if namespace == "models" and key == "config":
                value = dict(value or {})
                roles = dict(value.get("role_runners", {}))
                roles[role] = request_runner(roles.get(role, value.get("worker_runner")), model)
                value["role_runners"] = roles
            return value
    result = execute(RequestModelStore(home), task_path, workspace, attempt_dir)
    outputs = list((Path(attempt_dir) / "native-agent" / "attempts").glob("*/stdout.jsonl"))
    if not outputs:
        raise ValueError("No actual native model event artifact; reject result")
    # Current observed implementer is OMP; do not admit another transport silently.
    store = RequestModelStore(home)
    runner = store.get("models", "config", {}).get("role_runners", {}).get(role)
    if runner.get("adapter") != "omp":
        raise ValueError("This continuation's actual-model verification requires OMP JSON events")
    for output in outputs:
        verify_omp_model_events(output.read_text())
    return redact(result)


def specification(root, source_revision=SOURCE_REVISION, *, verify_delivery=True):
    revision = git(root, "rev-parse", source_revision + "^{commit}").decode().strip()
    def source_json(name):
        return json.loads(git(root, "show", f"{revision}:{SOURCE_ROOT}/{name}"))
    execution = source_json("execution-packages.json")
    dag = source_json("execution-dag.json")
    docs = {SOURCE_ROOT + "/work-packages.json": source_json("work-packages.json"),
            SOURCE_ROOT + "/code-intelligence.json": source_json("code-intelligence.json")}
    delivery = json.loads((root / SOURCE_ROOT / "delivery.json").read_text())
    if delivery["packageCommit"] != revision or sha(compact(delivery["packageFiles"]).encode()) != delivery["packageDigest"]:
        raise ValueError("Delivery revision/digest does not match the immutable specification")
    if verify_delivery:
        for artifact in delivery["packageFiles"]:
            data = git(root, "show", revision + ":" + artifact["path"])
            if len(data) != artifact["bytes"] or sha(data) != artifact["sha256"]:
                raise ValueError("Specification artifact hash/size mismatch: " + artifact["path"])
    packages = execution["packages"]
    ids = [p["id"] for p in packages]
    if execution["packageCount"] != 61 or len(ids) != 61 or len(set(ids)) != 61 or set(ids) != set(dag["nodes"]):
        raise ValueError("Expected 61 distinct normative execution packages")
    incoming = {identifier: set() for identifier in ids}
    for edge in dag["edges"]:
        if edge["from"] not in incoming or edge["to"] not in incoming:
            raise ValueError("Unknown specification dependency")
        incoming[edge["to"]].add(edge["from"])
    for p in packages:
        if set(p["dependencies"]) != incoming[p["id"]]:
            raise ValueError("Normative dependency list and DAG differ: " + p["id"])
        record = pointer(docs[p["sourceRecord"]["path"]], p["sourceRecord"]["jsonPointer"])
        if record["id"] != p["id"]:
            raise ValueError("sourceRecord identifies another work package")
        p["normativeRecord"] = record
    return {"revision": revision, "delivery": delivery, "execution": execution, "dag": dag,
            "packages": packages, "external": docs[SOURCE_ROOT + "/work-packages.json"]["external_prerequisite_gates"]}


def topo(nodes, dependencies):
    result, active, visited = [], set(), set()
    def visit(identifier):
        if identifier not in nodes:
            raise ValueError("Unknown dependency: " + identifier)
        if identifier in active:
            raise ValueError("Dependency graph contains a cycle")
        if identifier in visited:
            return
        active.add(identifier)
        for parent in dependencies[identifier]:
            visit(parent)
        active.remove(identifier)
        visited.add(identifier)
        result.append(identifier)
    for identifier in nodes:
        visit(identifier)
    return result


def unit_files(package):
    record = package["normativeRecord"]
    tests = record["tests"]
    if "source_test_command" in tests:
        argv = shlex.split(tests["source_test_command"])
        if argv[:2] != ["bun", "test"] or not argv[2:] or any(x.startswith("-") for x in argv[2:]):
            raise ValueError("Unsupported declared unit command: " + package["id"])
        files = argv[2:]
        if not set(files).issubset(tests["files"]):
            raise ValueError("Unit command is outside declared tests")
    else:
        files = list(dict.fromkeys(tests["existing"] + tests["proposed"]))
    if not files or any(not p.endswith(".test.ts") for p in files):
        raise ValueError("Explicit Bun .test.ts files required: " + package["id"])
    return files


def run_unit_files(root, files, *, bun="bun", timeout=300):
    """Execute each file separately so an empty proposed test cannot hide in a suite."""
    reports = []
    for name in files:
        path = root / name
        if not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
            raise ValueError("Declared test is missing or outside the workspace: " + name)
        result = subprocess.run([bun, "test", name], cwd=root, capture_output=True, timeout=timeout,
                                env={**os.environ, "NO_COLOR": "1", "FORCE_COLOR": "0"})
        output = re.sub(r"\x1b\[[0-9;]*m", "", (result.stdout + result.stderr).decode(errors="replace"))
        passes = re.findall(r"(?m)^\s*(\d+) pass\s*$", output)
        assertions = re.findall(r"(?m)^\s*(\d+) expect\(\) calls?\s*$", output)
        failures = re.findall(r"(?m)^\s*(\d+) fail\s*$", output)
        row = {"argv": [bun, "test", name], "exitCode": result.returncode,
               "testSha256": sha(path.read_bytes()), "stdoutSha256": sha(result.stdout),
               "stderrSha256": sha(result.stderr), "passes": int(passes[-1]) if passes else 0,
               "assertions": int(assertions[-1]) if assertions else 0,
               "failures": int(failures[-1]) if failures else None,
               "passedNames": re.findall(r"(?m)^\(pass\) (.+?)(?: \[[^\n]*\])?\s*$", output)}
        reports.append(row)
        print(output, file=sys.stderr, end="" if output.endswith("\n") else "\n")
        if result.returncode != 0 or row["passes"] < 1 or row["assertions"] < 1 or row["failures"] != 0:
            raise ValueError("Declared Bun test must pass with executed tests and nonempty assertions: " + name)
    return reports


WP01_CASES = [
    "identity: forged actor payload rejected",
    "membership: outsider cannot read private project title",
    "workspace: foreign workspace denied",
    "project: owner create and read stable canonical identity",
    "receipt: idempotent replay and payload conflict",
    "recovery: repository reopen preserves project and receipt",
    "negative-control: broken actor boundary is detected",
]
WP01_HOLDOUTS = [
    "holdout: cross-workspace receipt key collision rejected",
    "holdout: revoked membership after repository reopen denied",
]


def macro_source(root, revision=None):
    path = "plans/macro-integration/work-packages.json"
    revision = revision or git(root, "log", "-1", "--format=%H", "--", path).decode().strip()
    revision = git(root, "rev-parse", revision + "^{commit}").decode().strip()
    data = git(root, "show", revision + ":" + path)
    document = json.loads(data)
    index = next(i for i, p in enumerate(document["workPackages"]) if p["id"] == "WP-01")
    package = document["workPackages"][index]
    if package["dependencies"]:
        raise ValueError("WP-01 unexpectedly has prerequisites; re-review the first contribution")
    if len(package["newFiles"]) != 5 or "tests/macro-integration/wp-01.test.ts" not in package["newFiles"]:
        raise ValueError("Unexpected WP-01 new-file contract")
    if not package["verification"]["runner"].startswith("bun test tests/macro-integration/wp-01.test.ts;"):
        raise ValueError("WP-01 no longer declares the prepared Bun acceptance command")
    return {"revision": revision, "path": path, "sha256": sha(data), "jsonPointer": "/workPackages/" + str(index),
            "package": package}


def verify_wp01(root, revision, independent=False):
    source = macro_source(root, revision)
    reports = run_unit_files(root, ["tests/macro-integration/wp-01.test.ts"])
    required = WP01_CASES + (WP01_HOLDOUTS if independent else [])
    observed = reports[0]
    if observed["assertions"] < (24 if independent else 16) or any(
        not any(actual == name or actual.endswith(" > " + name) for actual in observed["passedNames"])
        for name in required
    ):
        raise ValueError("WP-01 contribution lacks executed identity/ACL/replay/reopen/semantic-control cases" + (" and independent holdouts" if independent else ""))
    return {"passed": True, "package": "WP-01", "acceptanceLevel": "independent-contribution" if independent else "implementation-contribution",
            "fullFeatureComplete": False, "sourceRevision": source["revision"], "cases": required, "files": reports}


def obligations(package):
    record = package["normativeRecord"]
    done = record.get("definition_of_done", record.get("definitionOfDone", []))
    result = [{"id": "DOD-" + str(i + 1), "text": text, "proofLevel": "consumer"} for i, text in enumerate(done)]
    for lane in record["tests"].get("proof_lanes", []):
        result.append({"id": "LANE-" + lane, "text": lane,
                       "proofLevel": "actual-product-ui" if lane == "ACTUAL_ELECTRON_UI" else "consumer"})
    if "seeded_negative_control" in record:
        result.append({"id": "SEEDED-NEGATIVE-CONTROL", "text": compact(record["seeded_negative_control"]),
                       "proofLevel": "semantic-negative-control"})
    # CI's source record contains explicit behavior assertions, not proof-lane enums.
    for i, text in enumerate(record.get("verification", [])):
        result.append({"id": "BEHAVIOR-" + str(i + 1), "text": text,
                       "proofLevel": "actual-product-ui" if "actual UI" in text or "UI keyboard" in text else "consumer"})
    return result


def validate_gate(gate, required, harness):
    criteria = gate.get("criteria", [])
    harness["validate_criteria"](criteria)
    covered = gate.get("coverage", {})
    criterion_ids = {c["id"] for c in criteria}
    for obligation in required:
        binding = covered.get(obligation["id"], {})
        if not binding.get("criterionIds") or not set(binding["criterionIds"]).issubset(criterion_ids):
            raise ValueError("Gate lacks independent coverage for " + obligation["id"])
        if binding.get("proofLevel") != obligation["proofLevel"]:
            raise ValueError("Gate has a weaker proof level for " + obligation["id"])
    for c in criteria:
        argv = c.get("argv", [])
        if c.get("kind", c.get("type")) != "command" or c.get("required", True) is not True:
            raise ValueError("Consumer/readiness gates require real required command criteria")
        if not argv or Path(argv[0]).name in ("echo", "printf", "true", "false", "test", "[", ":"):
            raise ValueError("No semantic command for readiness/consumer acceptance")
        if any("--self-test" in x or x == "verify-unit" for x in argv):
            raise ValueError("Compiler/unit-only checks cannot satisfy consumer acceptance")
        if c.get("allow_flaky") or int(c.get("max_attempts", 1)) != 1:
            raise ValueError("Consumer gates must not silently accept flaky checks")
        if c.get("expected_exit", 0) != 0:
            raise ValueError("Use a semantic negative-control verifier that itself returns zero")
    return criteria


def check_bundle(bundle, root, harness):
    if bundle["implementationRevision"] != git(root, "rev-parse", "HEAD").decode().strip():
        raise ValueError("Implementation HEAD changed; recompile the durable request")
    if bundle["runtimeSourceSha256"] != harness["hashes"]:
        raise ValueError("Harness source changed; recompile against its actual contracts")
    for artifact in bundle["contract"]["input_manifest"]:
        if sha((root / artifact["path"]).read_bytes()) != artifact["sha256"]:
            raise ValueError("Bound input changed: " + artifact["path"])
    core = {k: v for k, v in bundle.items() if k != "bundleSha256"}
    if bundle["bundleSha256"] != sha(compact(core).encode()):
        raise ValueError("Compiled bundle changed")


def bound_native_argv(bundle, identifier, root, workspace, attempt_dir, home, harness):
    """Validate portable lineage before handing work to the real native adapter."""
    check_bundle(bundle, root, harness)
    pack = bundle["taskPacks"][identifier]
    task_path = Path(bundle["packetDirectory"]) / "tasks" / identifier.split(":")[-1] / "task.json"
    if json.loads(task_path.read_text()) != pack:
        raise ValueError("Materialized native task pack changed")
    packet = pack["dispatch_packet"]
    if harness["canonical_hash"]({k: v for k, v in packet.items() if k != "packet_hash"}) != packet["packet_hash"]:
        raise ValueError("Portable dispatch packet changed")
    harness["verify_inputs"](packet)
    workspace = Path(workspace).resolve()
    if git(workspace, "merge-base", "--is-ancestor", bundle["implementationRevision"], "HEAD") != b"":
        raise ValueError("Native worktree does not descend from the reviewed implementation baseline")
    for artifact in packet["input_manifest"]:
        if sha((workspace / artifact["path"]).read_bytes()) != artifact["sha256"]:
            raise ValueError("Native worktree has different bound inputs: " + artifact["path"])
    current = runtime_models(home)
    if current["implementer"] != bundle["runtimeProfile"]["implementer"]:
        raise ValueError("Native implementer runner profile changed")
    if "nativeRoles" in bundle:
        database = Path(home).expanduser().resolve() / ".agents/state/journal.sqlite3"
        with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as db:
            row = db.execute("SELECT value FROM kv WHERE namespace=? AND key=?", ("models", "config")).fetchone()
        roles = json.loads(row[0]).get("role_runners", {}) if row else {}
        if any(roles.get(role) != profile for role, profile in bundle["nativeRoles"].items()):
            raise ValueError("Contribution native role runner changed")
    # This is the supported, installed Harness producer CLI discovered locally.
    return [sys.executable, str(root / SCRIPT_PATH), "run-pinned-native", "--runtime", harness["runtime"], "--model", bundle["requestModel"], "--home", str(Path(home).expanduser().resolve()),
            "--task", str(task_path), "--workspace", str(workspace), "--attempt-dir", str(Path(attempt_dir).resolve())]


def compile_graph(args, harness):
    root = Path(args.cwd).expanduser().resolve()
    spec = specification(root, args.source_revision)
    head = git(root, "rev-parse", "HEAD").decode().strip()
    if args.implementation_revision and git(root, "rev-parse", args.implementation_revision + "^{commit}").decode().strip() != head:
        raise ValueError("Requested implementation revision is not current HEAD")
    dirty = git(root, "status", "--porcelain=v1", "--untracked-files=normal").decode().splitlines()
    request_id = args.request_id or "rox-compound-" + head[:12]
    if not re.fullmatch(r"[A-Za-z0-9._:-]{1,70}", request_id):
        raise ValueError("Request ID must be a short Harness identifier")
    packet_dir = Path(args.materialize or (Path(tempfile.gettempdir()) / (request_id + "-packets"))).expanduser().resolve()
    if packet_dir.is_relative_to(root):
        raise ValueError("Materialized runtime packets must be outside the implementation checkout")
    models = runtime_models(args.home)
    request_runner(models["implementer"], args.model)
    inputs = [SOURCE_ROOT + "/" + x for x in (
        "execution-packages.json", "execution-dag.json", "work-packages.json", "code-intelligence.json", "delivery.json")]
    inputs.append(SCRIPT_PATH)
    for path in inputs[:-2]:
        if (root / path).read_bytes() != git(root, "show", spec["revision"] + ":" + path):
            raise ValueError("Normative source differs from the bound spec commit: " + path)
    gate_map = {"gates": {}}
    if args.gate_map:
        gate_path = Path(args.gate_map).expanduser().resolve()
        if not gate_path.is_relative_to(root):
            raise ValueError("Gate map must be a revision-bound repository input")
        inputs.append(gate_path.relative_to(root).as_posix())
        gate_map = json.loads(gate_path.read_text())
        if gate_map.get("implementationRevision") != head or gate_map.get("sourceRevision") != spec["revision"]:
            raise ValueError("Gate map is bound to another implementation/spec revision")
    contract = harness["envelope"](
        objective="Implement the 61 bound Lark/Code Intelligence packages with isolated worker outputs, lead-owned shared integration and separate full consumer acceptance.",
        cwd=str(root), acceptance=[
            "Preserve all 61 normative source records, original 161 edges, external Macro/Suite requirements and exact worker paths.",
            "Each declared Bun unit file executes passing tests and at least one assertion; unit acceptance is an implementation artifact stage.",
            "Only the lead owns shared integration; full completion requires the source definition of done and actual consumer proof lanes.",
            "Missing prerequisites, native product UI, semantic controls or readback commands keep completion unresolved."],
        mode="execute", request_id=request_id, request_revision=args.request_revision,
        allowed_operations=["read", "write-artifact", "execute-command"], delivery="local",
        independent_units=61, durable=True, inputs=inputs)
    gate_defs = {}
    for external in spec["external"]:
        gate_defs[external["gate_id"]] = {
            "kind": "external-prerequisite", "owner": "integration-owner",
            "requirements": [{"id": "READINESS", "text": compact(external), "proofLevel": "consumer"}]}
    for name, text in (
        ("CI-REPOSITORY-POLICY", "CI scoped repository/egress policy"),
        ("CI-PROVIDER-READINESS", "Upstream provider version/license/runtime readiness"),
        ("CI-NATIVE-TRANSPORT", "Native agent transport when tools used"),
        ("HARNESS-IMPLEMENTER", "Fresh native implementer capability, unchanged approval policy and executable model/auth transport")):
        gate_defs[name] = {"kind": "external-prerequisite", "owner": "integration-owner",
                           "requirements": [{"id": "READINESS", "text": text, "proofLevel": "consumer"}]}
    packages = {p["id"]: p for p in spec["packages"]}
    order = topo(list(packages), {k: p["dependencies"] for k, p in packages.items()})
    gate_templates, task_packs, metadata, tasks = {}, {}, {}, []
    def tid(name):
        return request_id + ":" + name
    def add_gate(name, definition, deps):
        required = definition["requirements"]
        supplied = gate_map.get("gates", {}).get(name)
        state = "COMMANDS_CONFIGURED_NOT_RUN" if supplied else "UNRESOLVED"
        if supplied:
            validate_gate(supplied, required, harness)
        gate_templates[name] = {**definition, "status": state, "criteria": supplied.get("criteria", []) if supplied else [],
                                "coverage": supplied.get("coverage", {}) if supplied else {}}
        argv = [sys.executable, str(root / SCRIPT_PATH), "check-gate", "--bundle", str(packet_dir / "bundle.json"), "--gate", name,
                "--cwd", str(root), "--runtime", harness["runtime"]]
        criteria = [{"id": "independent-" + name, "kind": "command", "argv": argv, "expected_exit": 0, "timeout": 900}]
        node = {"id": tid(name), "objective": "Lead-owned " + definition["kind"] + " acceptance: " + name,
                "cwd": str(root), "depends_on": [tid(d) for d in deps], "role": "verifier", "owner": "integration-owner",
                "owned_paths": [], "isolate": False, "argv": argv, "criteria": criteria,
                "timeout": 900, "max_attempts": 1, "retry_safe": True, "request_id": request_id,
                "env": {"PYTHONDONTWRITEBYTECODE": "1"}}
        tasks.append(harness["normalize"](node))
        metadata[tid(name)] = {"stage": definition["kind"], "readiness": state, "automaticFeatureCompletion": False,
                              "sharedPatchPaths": definition.get("sharedPatchPaths", [])}
    for name, definition in gate_defs.items():
        add_gate(name, definition, [])
    previous_integration = None
    for identifier in order:
        p = packages[identifier]
        owned = [harness["relative_path"](x) for x in p["allowedWritePaths"]]
        shared = [harness["relative_path"](x) for x in p["sharedPatchPaths"]]
        if not owned or len(set(owned)) != len(owned) or set(owned) & set(shared):
            raise ValueError("Invalid new/shared ownership: " + identifier)
        external = list(p["normativeRecord"].get("external_prerequisites", []))
        if identifier.startswith("CI-"):
            external = ["EG-IDENTITY", "CI-REPOSITORY-POLICY", "CI-PROVIDER-READINESS", "CI-NATIVE-TRANSPORT"]
        if any(name not in gate_defs for name in external):
            raise ValueError("Unrepresented external prerequisite: " + identifier)
        deps = [dep + "-ACCEPT" for dep in p["dependencies"]] + external + ["HARNESS-IMPLEMENTER"]
        verification = [sys.executable, SCRIPT_PATH, "verify-unit", "--package", identifier,
                        "--source-revision", spec["revision"], "--cwd", "."]
        task = {"id": tid(identifier), "task_id": tid(identifier), "role": "implementer", "owner": "implementation:" + identifier,
                "objective": identifier + ": " + p["title"] + ". Implement only original allowedWritePaths; retain current theme/font and existing behavior. Return shared-file patch requests to the lead. Unit success means artifact acceptance; the consumer definition of done remains a separate gate.",
                "owned_paths": owned, "outputs": owned, "depends_on": [tid(x) for x in deps],
                "verification_argv": verification, "operations": ["read", "write-artifact", "execute-command"],
                "attempt_id": "prepared-" + head[:12] + "-" + identifier}
        packet = harness["dispatch_packet"](contract, task, client="native")
        pack = {**task, "request_id": request_id, "control_revision": args.request_revision - 1,
                "contract": contract, "dispatch_packet": packet,
                "acceptance": ["Only the original owned paths are changed.", "Every declared unit test file passes with nonempty assertions.",
                               "No library-only, fixture-only or queued receipt claim of full product completion."],
                "sourceRecord": p["sourceRecord"], "normativeRecord": p["normativeRecord"],
                "referencePackageRevision": spec["revision"], "referencePackageDigest": spec["delivery"]["packageDigest"],
                "sharedPatchPaths": shared, "sharedFileOwner": "integration-owner", "unitFiles": unit_files(p)}
        if len(json.dumps(pack, ensure_ascii=False)) + 3000 > models["contextLimit"]:
            raise ValueError("Full normative worker contract exceeds current native context limit: " + identifier)
        task_packs[tid(identifier)] = pack
        criteria = [{"id": "functional-declared-bun-tests", "kind": "command", "argv": verification,
                     "expected_exit": 0, "timeout": 900}]
        criteria += [{"id": "artifact-" + str(i), "kind": "file", "path": path, "min_bytes": 1} for i, path in enumerate(owned)]
        native_argv = [sys.executable, str(root / SCRIPT_PATH), "run-native", "--bundle", str(packet_dir / "bundle.json"),
                       "--task-id", tid(identifier), "--home", str(Path(args.home).expanduser().resolve()),
                       "--workspace", "{workspace}", "--attempt-dir", "{attempt_dir}", "--runtime", harness["runtime"]]
        tasks.append(harness["normalize"]({"id": tid(identifier), "objective": task["objective"], "cwd": str(root),
                     "role": "implementer", "owner": task["owner"], "owned_paths": owned, "isolate": True,
                     "depends_on": task["depends_on"], "argv": native_argv, "criteria": criteria,
                     "request_id": request_id, "contract": contract, "timeout": 1800, "max_attempts": 2, "retry_safe": True,
                     "env": {"PYTHONDONTWRITEBYTECODE": "1"}}))
        metadata[tid(identifier)] = {"stage": "isolated-implementation-artifact", "packageId": identifier,
                                    "readiness": "PREPARED_NOT_LAUNCHED", "automaticFeatureCompletion": False}
        integration_name = identifier + "-INTEGRATE"
        integration = {"kind": "shared-integration", "owner": "integration-owner", "sharedPatchPaths": shared,
                       "requirements": [{"id": "INTEGRATED-CONSUMER", "text": "Lead reviews/applies listed shared patches serially and independently exercises the integrated consumer at exact authoritative refs; preserve native receipt/revision/hash readback.", "proofLevel": "consumer"}]}
        add_gate(integration_name, integration, [identifier] + ([previous_integration] if previous_integration else []))
        previous_integration = integration_name
        add_gate(identifier + "-ACCEPT", {"kind": "full-consumer-acceptance", "owner": "integration-owner",
                                          "requirements": obligations(p)}, [integration_name])
    # Detect any simultaneous implementation ownership overlap independently of source prose.
    owner = {}
    for p in spec["packages"]:
        for path in p["allowedWritePaths"]:
            if path in owner:
                raise ValueError("Original new-file ownership collision: " + path)
            owner[path] = p["id"]
    nodes = [t["id"] for t in tasks]
    compiled_order = topo(nodes, {t["id"]: t["depends_on"] for t in tasks})
    unresolved = [name for name, gate in gate_templates.items() if gate["status"] == "UNRESOLVED"]
    result = {"schemaVersion": 1, "status": "DRY_RUN_PREPARED_NOT_LAUNCHED", "noExecutorLaunched": True,
              "sourceRevision": spec["revision"], "sourcePackageDigest": spec["delivery"]["packageDigest"],
              "sourceArtifactsVerified": len(spec["delivery"]["packageFiles"]), "implementationRevision": head,
              "implementationWorkingTreeClean": not dirty, "dirtyPaths": dirty, "requestId": request_id,
              "contract": contract, "runtimeSourceSha256": harness["hashes"], "runtimeProfile": models, "requestModel": args.model,
              "nativeCapabilitySnapshotState": "NOT_PROBED_NO_READY_OPERATION_CLAIM", "packetDirectory": str(packet_dir),
              "originalPackageCount": len(packages), "originalDependencyEdges": spec["dag"]["edges"],
              "crossProgramDependencies": spec["dag"]["crossProgramDependencies"], "tasks": tasks,
              "taskPacks": task_packs, "nodeMetadata": metadata, "topologicalOrder": compiled_order,
              "gateMapTemplate": {"sourceRevision": spec["revision"], "implementationRevision": head, "gates": gate_templates},
              "unresolvedRequirements": unresolved, "readyForSubmission": False,
              "submissionPolicy": "Dry-run only. Materialize on explicit clean implementation HEAD, then independently verify launch scope and actual readiness. This compiler never submits. Shared integration remains the lead's work.",
              "runtimeLimitations": ["Scheduler has no passive requirement/human-lead approval node; missing gate commands fail with exit 78.",
                                     "Harness native workers validate capability snapshots but do not independently call accept_return; scheduler command acceptance and isolated CAS integration retain their own durable receipts.",
                                     "Local native runner profile is observed, not a fresh capability probe; no general cloud coding transport is prepared.",
                                     "Command criteria require lead semantic review; this compiler does not infer product/UI acceptance from file presence or unit tests."]}
    result["bundleSha256"] = sha(compact(result).encode())
    return result


def compile_macro_wp01(args, harness):
    """A ready contribution pair, with full native feature acceptance retained by the lead."""
    root = Path(args.cwd).expanduser().resolve()
    source = macro_source(root)
    package = source["package"]
    if (root / source["path"]).read_bytes() != git(root, "show", source["revision"] + ":" + source["path"]):
        raise ValueError("Macro WP-01 normative source has uncommitted changes")
    head = git(root, "rev-parse", "HEAD").decode().strip()
    if args.implementation_revision and git(root, "rev-parse", args.implementation_revision + "^{commit}").decode().strip() != head:
        raise ValueError("Requested WP-01 implementation baseline is not HEAD")
    dirty = git(root, "status", "--porcelain=v1", "--untracked-files=normal").decode().splitlines()
    request_id = args.request_id or "rox-macro-wp01-" + head[:12]
    if not re.fullmatch(r"[A-Za-z0-9._:-]{1,70}", request_id):
        raise ValueError("Request ID must be a short Harness identifier")
    packet_dir = Path(args.materialize or (Path(tempfile.gettempdir()) / (request_id + "-packets"))).expanduser().resolve()
    if packet_dir.is_relative_to(root):
        raise ValueError("Runtime packs must be outside the implementation checkout")
    models = runtime_models(args.home)
    request_runner(models["implementer"], args.model)
    with sqlite3.connect((Path(args.home).expanduser().resolve() / ".agents/state/journal.sqlite3").as_uri() + "?mode=ro", uri=True) as db:
        row = db.execute("SELECT value FROM kv WHERE namespace=? AND key=?", ("models", "config")).fetchone()
    profile = json.loads(row[0]) if row else {}
    roles = profile.get("role_runners", {})
    for role in ("implementer", "research"):
        runner = roles.get(role)
        if not isinstance(runner, dict) or not Path(runner.get("executable", "")).is_file():
            raise ValueError("No installed native runner for contribution role: " + role)
    owned = [harness["relative_path"](x) for x in package["newFiles"]]
    affected = [harness["relative_path"](x) for x in package["affectedFiles"]]
    if set(owned) & set(affected):
        raise ValueError("WP-01 original new/shared paths overlap")
    contract = harness["envelope"](
        objective="Implement and independently verify the Macro WP-01 minimal identity/private-Project contribution in its five declared new files. The lead integrates existing transport/RPC/UI paths and owns native full-feature acceptance.",
        cwd=str(root), mode="execute", request_id=request_id, request_revision=args.request_revision,
        acceptance=[
            "Build the source WP-01 typed project.createShared/get contracts, authenticated actor boundary, workspace membership, owner-only private Project repository and durable idempotent receipt.",
            "The actual declared Bun test imports the new production modules and exercises owner read/create, outsider redaction, forged actor/foreign workspace denial, replay/conflict and reopen recovery with nonempty assertions.",
            "A separate native verifier adds two adversarial holdouts without changing production modules and proves that a seeded broken actor boundary is detected semantically.",
            "Only the five original new files can change; the eight existing affected paths remain lead-owned serial integration requests.",
            "Contribution acceptance does not close native HTTP/RPC/Electron full feature DoD or EG-IDENTITY readiness; exact real consumer/restart receipts are required separately."],
        allowed_operations=["read", "write-artifact", "execute-command"], delivery="local",
        independent_units=2, durable=True, inputs=[source["path"], SCRIPT_PATH])
    tasks, packs, metadata = [], {}, {}
    common = {"referencePackageRevision": source["revision"], "sourceRecord": {"path": source["path"], "jsonPointer": source["jsonPointer"], "sha256": source["sha256"]},
              "normativeRecord": package, "sharedPatchPaths": affected, "sharedFileOwner": "integration-owner",
              "fullFeatureComplete": False, "acceptanceLevel": "contribution-only", "request_id": request_id,
              "contract": contract, "requiredExecutedTestNames": WP01_CASES}
    objective = (
        "Implement WP-01's complete bound normativeRecord in exactly its five new files. Enforce trusted transport actor, membership, owner-only private Project, payload validation, durable transaction/receipt/reopen and explicit standalone mode. "
        "Tests import actual production modules, invoke their public operations against temporary durable storage, use exact requiredExecutedTestNames and at least 16 expect assertions. Detect deliberately broken actor-boundary disclosure semantically. "
        "Return existing-path transport/RPC/UI patch requests to the lead. No extra framework/manifests, shared-file edits, commits, pushes, global runtime/config/approval changes or full-feature completion claim.")
    for name, role, owner, paths, deps, text, independent in (
        ("WP-01-IMPLEMENT", "implementer", "identity-implementation", owned, [], objective, False),
        ("WP-01-VERIFY", "research", "independent-identity-verifier", ["tests/macro-integration/wp-01.test.ts"], [request_id + ":WP-01-IMPLEMENT"],
         "Independently audit the accepted WP-01 production contribution against the complete normative record. Own only its existing declared test file, after the implementer. Exercise actual modules and durable storage, add the exact requiredHoldoutTestNames (at least 24 total executed expect assertions), and expose cross-workspace receipt-key collision plus revoke-after-reopen bugs. Verify typed body actor rejection, no private title on denied reads, stable canonical identity, idempotency/conflict and crash/reopen recovery. Prove the seeded broken actor boundary is caught by a specific semantic assertion; do not count timeouts/import failures as a caught mutation. If production is wrong, fail acceptance and return a concrete repair request; do not patch production or weaken assertions. Unit/contribution acceptance cannot close actual native RPC/HTTP/Electron DoD. No commits, pushes or runtime/config changes.", True),
    ):
        identifier = request_id + ":" + name
        verify = [sys.executable, SCRIPT_PATH, "verify-wp01", "--source-revision", source["revision"], "--cwd", "."]
        if independent:
            verify.append("--independent")
        task = {"id": identifier, "task_id": identifier, "role": role, "owner": owner, "objective": text,
                "owned_paths": paths, "outputs": paths, "depends_on": deps, "verification_argv": verify,
                "operations": ["read", "write-artifact", "execute-command"], "attempt_id": "prepared-" + head[:12] + "-" + name}
        packet = harness["dispatch_packet"](contract, task, client="native")
        pack = {**task, **common, "control_revision": args.request_revision - 1,
                "dispatch_packet": packet, "acceptance": [
            "Actual new-module identity/ACL/replay/reopen tests pass with required executed cases and assertions.",
            "Only assigned files change; the lead retains shared integration and full native feature acceptance."]}
        if independent:
            pack["requiredHoldoutTestNames"] = WP01_HOLDOUTS
        if len(json.dumps(pack, ensure_ascii=False)) + 2500 > models["contextLimit"]:
            raise ValueError("Full WP-01 native contract exceeds current context limit")
        packs[identifier] = pack
        criteria = [{"id": "substantive-identity-contribution", "kind": "command", "argv": verify,
                     "expected_exit": 0, "timeout": 900}]
        node = {"id": identifier, "objective": text, "cwd": str(root), "role": role, "owner": owner,
                "owned_paths": paths, "isolate": True, "depends_on": deps, "contract": contract, "request_id": request_id,
                "argv": [sys.executable, str(root / SCRIPT_PATH), "run-native", "--bundle", str(packet_dir / "bundle.json"),
                         "--task-id", identifier, "--home", str(Path(args.home).expanduser().resolve()),
                         "--workspace", "{workspace}", "--attempt-dir", "{attempt_dir}", "--runtime", harness["runtime"]],
                "criteria": criteria, "timeout": 2400, "max_attempts": 2, "retry_safe": True,
                "env": {"PYTHONDONTWRITEBYTECODE": "1"}}
        tasks.append(harness["normalize"](node))
        metadata[identifier] = {"stage": "independent-contribution-verifier" if independent else "isolated-contribution-implementation",
                                "automaticFeatureCompletion": False, "sharedPatchPaths": affected}
    order = topo([t["id"] for t in tasks], {t["id"]: t["depends_on"] for t in tasks})
    result = {"schemaVersion": 1, "status": "CONTRIBUTION_PREPARED_NOT_LAUNCHED", "noExecutorLaunched": True,
              "sourceRevision": source["revision"], "sourceRecordSha256": source["sha256"], "implementationRevision": head,
              "implementationWorkingTreeClean": not dirty, "dirtyPaths": dirty, "requestId": request_id,
              "contract": contract, "runtimeSourceSha256": harness["hashes"], "runtimeProfile": models, "requestModel": args.model,
              "nativeRoles": {role: roles[role] for role in ("implementer", "research")}, "packetDirectory": str(packet_dir),
              "originalPackageCount": 1, "originalDependencyEdges": [], "tasks": tasks, "taskPacks": packs,
              "nodeMetadata": metadata, "topologicalOrder": order, "unresolvedRequirements": [],
              "gateMapTemplate": {"gates": {}},
              "readyForSubmission": bool(args.implementation_revision and not dirty),
              "submissionPolicy": "Only this contribution pair may be submitted after explicit root baseline commit and native runner readiness review. No full-feature completion or EG-IDENTITY promotion is generated.",
              "fullFeatureComplete": False, "fullFeatureAcceptanceRetainedBy": "integration-owner",
              "fullFeatureRequirements": {"acceptanceCriteria": package["acceptanceCriteria"], "verificationGate": package["verificationGate"],
                                          "bootstrapContract": package["bootstrapContract"], "artifacts": package["verification"]["artifacts"], "sharedPatchPaths": affected},
              "runtimeLimitations": ["No generic cloud coding executor; the prepared pair uses installed local Harness native role runners.",
                                     "Runner profile/executable checks do not prove current provider authentication; root verifies launch readiness.",
                                     "Accepted contribution code/tests do not alone satisfy real native Project RPC/HTTP/UI/restart acceptance."]}
    result["bundleSha256"] = sha(compact(result).encode())
    return result


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x") as out:
        json.dump(value, out, ensure_ascii=False, indent=2)
        out.write("\n")
    os.chmod(path, 0o600)


def self_test(root, harness):
    """Behavioral negative controls for the executable verifier, not source-text tests."""
    count = 0
    original = {"adapter": "omp", "executable": "/existing/omp", "thinking": "low", "permission_policy": "existing"}
    selected = request_runner(original, PINNED_MODEL)
    assert selected["model"] == PINNED_MODEL and "model" not in original
    assert selected["permission_policy"] == original["permission_policy"]
    count += 1
    event = {"type": "message_end", "message": {"role": "assistant", "provider": "openai-codex", "model": "gpt-6.1-sol"}}
    assert verify_omp_model_events(json.dumps(event)) == 1
    count += 1
    for output in ("", json.dumps({**event, "message": {**event["message"], "model": "gpt-6-luna"}})):
        try:
            verify_omp_model_events(output)
        except ValueError:
            count += 1
        else:
            raise AssertionError("Accepted absent or fallback actual model evidence")
    try:
        request_runner(original, "default")
    except ValueError:
        count += 1
    else:
        raise AssertionError("Compiler accepted a default/fallback model")
    with tempfile.TemporaryDirectory(prefix="rox-dispatch-verifier-") as temporary:
        fixture = Path(temporary)
        (fixture / "passing.test.ts").write_text("import {test,expect} from 'bun:test'; test('semantic equality',()=>expect(2+2).toBe(4));\n")
        (fixture / "empty.test.ts").write_text("import {test} from 'bun:test'; test('empty',()=>{});\n")
        (fixture / "failing.test.ts").write_text("import {test,expect} from 'bun:test'; test('seeded incorrect result',()=>expect(2+2).toBe(5));\n")
        assert run_unit_files(fixture, ["passing.test.ts"])[0]["assertions"] == 1
        count += 1
        for names in (["empty.test.ts"], ["passing.test.ts", "empty.test.ts"], ["failing.test.ts"], ["missing.test.ts"]):
            try:
                run_unit_files(fixture, names)
            except ValueError:
                count += 1
            else:
                raise AssertionError("Verifier accepted empty/failing/missing tests")
    for deps in ({"a": ["b"], "b": ["a"]}, {"a": ["unknown"]}):
        try:
            topo(list(deps), deps)
        except ValueError:
            count += 1
        else:
            raise AssertionError("Compiler accepted invalid dependencies")
    requirement = [{"id": "UI", "text": "actual native UI", "proofLevel": "actual-product-ui"}]
    for gate in (
        {"criteria": [{"id": "file", "kind": "file", "path": "fake.png"}]},
        {"criteria": [{"id": "echo", "kind": "command", "argv": ["echo", "PASS"]}], "coverage": {"UI": {"criterionIds": ["echo"], "proofLevel": "actual-product-ui"}}},
        {"criteria": [{"id": "unit", "kind": "command", "argv": [sys.executable, SCRIPT_PATH, "verify-unit"]}], "coverage": {"UI": {"criterionIds": ["unit"], "proofLevel": "actual-product-ui"}}}):
        try:
            validate_gate(gate, requirement, harness)
        except ValueError:
            count += 1
        else:
            raise AssertionError("Compiler accepted fabricated/weaker UI acceptance")
    return {"passed": True, "behavioralChecks": count, "runtimeJobsLaunched": 0}


def main():
    default_root = Path(__file__).resolve().parents[2]
    if len(sys.argv) > 1 and sys.argv[1] == "run-pinned-native":
        parser = argparse.ArgumentParser(description="Request-local model pin; no global runner configuration writes")
        for key in ("runtime", "model", "home", "task", "workspace", "attempt-dir"):
            parser.add_argument("--" + key, required=True)
        args = parser.parse_args(sys.argv[2:])
        print(compact(execute_pinned_native(args.runtime, args.home, args.task, args.workspace, args.attempt_dir, args.model)))
        return 0
    if len(sys.argv) > 1 and sys.argv[1] == "run-native":
        parser = argparse.ArgumentParser(description="Internal Scheduler producer: check reviewed bindings, then invoke actual Harness native runner")
        parser.add_argument("--bundle", required=True)
        parser.add_argument("--task-id", required=True)
        parser.add_argument("--workspace", required=True)
        parser.add_argument("--attempt-dir", required=True)
        parser.add_argument("--home", required=True)
        parser.add_argument("--runtime", required=True)
        args = parser.parse_args(sys.argv[2:])
        harness = load_harness(args.runtime)
        bundle = json.loads(Path(args.bundle).read_text())
        root = Path(bundle["contract"]["cwd"]).resolve()
        argv = bound_native_argv(bundle, args.task_id, root, args.workspace, args.attempt_dir, args.home, harness)
        result = subprocess.run(argv, cwd=Path(args.workspace).resolve(), check=False)
        check_bundle(bundle, root, harness)
        return result.returncode
    if len(sys.argv) > 1 and sys.argv[1] == "verify-wp01":
        parser = argparse.ArgumentParser(description="Exercise real WP-01 modules and semantic identity/replay/recovery assertions")
        parser.add_argument("--cwd", default=".")
        parser.add_argument("--source-revision", required=True)
        parser.add_argument("--independent", action="store_true")
        args = parser.parse_args(sys.argv[2:])
        print(compact(verify_wp01(Path(args.cwd).resolve(), args.source_revision, args.independent)))
        return 0
    if len(sys.argv) > 1 and sys.argv[1] == "verify-unit":
        parser = argparse.ArgumentParser(description="Run declared Bun files; reject skipped/empty/no-assertion success")
        parser.add_argument("--cwd", default=".")
        parser.add_argument("--package", required=True)
        parser.add_argument("--source-revision", default=SOURCE_REVISION)
        args = parser.parse_args(sys.argv[2:])
        root = Path(args.cwd).resolve()
        spec = specification(root, args.source_revision, verify_delivery=False)
        package = next(p for p in spec["packages"] if p["id"] == args.package)
        reports = run_unit_files(root, unit_files(package))
        print(compact({"passed": True, "acceptanceLevel": "unit-artifact-only", "package": args.package,
                       "sourceRevision": spec["revision"], "inputRevision": git(root, "rev-parse", "HEAD").decode().strip(), "files": reports}))
        return 0
    if len(sys.argv) > 1 and sys.argv[1] == "check-gate":
        parser = argparse.ArgumentParser(description="Independently execute bound lead consumer/readiness criteria")
        parser.add_argument("--bundle", required=True)
        parser.add_argument("--gate", required=True)
        parser.add_argument("--cwd", default=".")
        parser.add_argument("--runtime", default=str(Path.home() / ".agents/runtime"))
        args = parser.parse_args(sys.argv[2:])
        root = Path(args.cwd).resolve()
        harness = load_harness(args.runtime)
        bundle = json.loads(Path(args.bundle).read_text())
        check_bundle(bundle, root, harness)
        gate = bundle["gateMapTemplate"]["gates"][args.gate]
        if gate["status"] == "UNRESOLVED":
            print(compact({"status": "UNRESOLVED", "gate": args.gate, "requirements": gate["requirements"]}), file=sys.stderr)
            return UNRESOLVED_EXIT
        criteria = validate_gate(gate, gate["requirements"], harness)
        # Evidence is outside source and global runtime; the enclosing Scheduler
        # verifier additionally captures stdout/stderr, hashes and attachments.
        evidence = Path(args.bundle).resolve().parent / "gate-evidence" / args.gate / os.urandom(8).hex()
        report = harness["evaluate"](criteria, root, evidence_dir=evidence)
        print(compact({"gate": args.gate, "bundleSha256": bundle["bundleSha256"], "evidence": str(evidence), "report": report}))
        check_bundle(bundle, root, harness)
        return 0 if report["passed"] else 1
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cwd", default=str(default_root))
    parser.add_argument("--runtime", default=str(Path.home() / ".agents/runtime"))
    parser.add_argument("--home", default=str(Path.home()))
    parser.add_argument("--source-revision", default=SOURCE_REVISION)
    parser.add_argument("--implementation-revision")
    parser.add_argument("--model", default=PINNED_MODEL, help="Exact request-local model pin; global runner profiles remain unchanged")
    parser.add_argument("--request-id")
    parser.add_argument("--request-revision", type=int, default=1)
    parser.add_argument("--gate-map")
    parser.add_argument("--macro-wp01", action="store_true", help="Prepare the independent two-node WP-01 contribution instead of the 61-package DAG")
    parser.add_argument("--output", help="Write dry-run JSON to a new file; no overwrite")
    parser.add_argument("--materialize", help="Prepare a new outside-checkout packet directory on a clean, explicitly bound HEAD; never submit")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    harness = load_harness(args.runtime)
    if args.self_test:
        print(compact(self_test(Path(args.cwd), harness)))
        return 0
    if args.macro_wp01 and args.gate_map:
        raise ValueError("WP-01 contribution preparation has no full-feature gate map")
    result = compile_macro_wp01(args, harness) if args.macro_wp01 else compile_graph(args, harness)
    if args.materialize:
        if not args.implementation_revision or not result["implementationWorkingTreeClean"]:
            raise ValueError("Materialization requires explicit implementation HEAD and a clean checkout; use dry-run until the root commit")
        directory = Path(result["packetDirectory"])
        if directory.exists():
            raise ValueError("Packet directory already exists; preserve the previous revision/attempt")
        directory.mkdir(parents=True, mode=0o700)
        for key, pack in result["taskPacks"].items():
            write_json(directory / "tasks" / key.split(":")[-1] / "task.json", pack)
        write_json(directory / "bundle.json", result)
        # No readyForSubmission=true projection exists: the lead must resolve
        # actual gate commands and verify readiness before submitting anything.
        write_json(directory / "scheduler-candidate.json", {"tasks": result["tasks"]})
    if args.output:
        write_json(args.output, result)
        print(compact({"path": str(Path(args.output).resolve()), "bundleSha256": result["bundleSha256"],
                       "packages": result["originalPackageCount"], "nodes": len(result["tasks"]),
                       "unresolvedGates": len(result["unresolvedRequirements"]), "readyForSubmission": result["readyForSubmission"], "jobsLaunched": 0}))
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, KeyError, StopIteration, OSError, subprocess.SubprocessError) as error:
        print(compact({"error": str(error), "jobsLaunched": 0}), file=sys.stderr)
        raise SystemExit(1)
