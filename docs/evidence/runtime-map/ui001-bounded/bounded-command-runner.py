import datetime, json, os, pathlib, signal, subprocess, sys, time

artifact_dir = pathlib.Path(sys.argv[1])
label = sys.argv[2]
deadline = int(sys.argv[3])
command = sys.argv[4:]
artifact_dir.mkdir(parents=True, exist_ok=True)
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
begin = time.monotonic()
with (artifact_dir / (label + '.log')).open('w') as output:
    child = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    timed_out = False
    try:
        exit_code = child.wait(timeout=deadline)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
        exit_code = 124
receipt = {
    'label': label, 'command': command, 'cwd': str(pathlib.Path.cwd()),
    'startedUtc': started, 'elapsedSeconds': round(time.monotonic() - begin, 3),
    'exitCode': exit_code, 'timedOut': timed_out, 'timeoutSeconds': deadline,
    'environment': {key: value for key, value in os.environ.items() if key.startswith('ROX_UI001_')},
    'log': label + '.log',
}
(artifact_dir / (label + '.json')).write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2), flush=True)
sys.exit(exit_code)
