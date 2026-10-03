"""Read-only capabilities; never replaces OMP locks or edits the pinned runtime."""
import json
import platform
import socket

results = {"class": "native-environment", "platform": platform.platform(), "architecture": platform.machine(), "checks": {}}
for label, family in (("unix_socket", socket.AF_UNIX), ("ipv4_loopback", socket.AF_INET)):
    try:
        with socket.socket(family, socket.SOCK_STREAM) as probe:
            probe.bind("\0rox-native-lock-validation" if family == socket.AF_UNIX else ("127.0.0.1", 0))
        results["checks"][label] = {"status": "available"}
    except OSError as error:
        results["checks"][label] = {"status": "blocked", "errno": error.errno, "message": str(error)}
print(json.dumps(results, ensure_ascii=False, indent=2))
