#!/usr/bin/env python3
"""Create encrypted pre-migration backup from the running website's credentials.

Run as root on the web host. Never prints secrets or materializes a plaintext dump.
Does not change application or database state. The recovery key is stored separately
from archives, root-only; copy it into the operator's secure recovery storage.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
from urllib.parse import unquote, urlsplit


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def encrypt_pipeline(command, destination, recipient, env=None):
    with destination.open("xb") as archive:
        producer = subprocess.Popen(command, stdout=subprocess.PIPE, env=env,
                                    stderr=subprocess.PIPE)
        consumer = subprocess.Popen(["age", "-r", recipient], stdin=producer.stdout,
                                    stdout=archive, stderr=subprocess.PIPE)
        producer.stdout.close()
        _, consumer_error = consumer.communicate()
        _, producer_error = producer.communicate()
    if producer.returncode or consumer.returncode:
        destination.unlink(missing_ok=True)
        # DB/tool errors can contain a connection string; don't print stderr.
        raise RuntimeError("encrypted backup pipeline failed: producer=%s consumer=%s" %
                           (producer.returncode, consumer.returncode))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--service", default="rox-one-website.service")
    parser.add_argument("--base-dir", default="/opt/rox-one/deploy-backups")
    parser.add_argument("--key-dir", default="/var/lib/rox-sso-recovery")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError("run as root on the web host")
    os.umask(0o077)
    key_dir = Path(args.key_dir)
    key_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    key = key_dir / "website-backup.agekey"
    if not key.exists():
        with key.open("xb") as stream:
            run(["age-keygen"], stdout=stream, stderr=subprocess.DEVNULL)
    key.chmod(0o600)
    recipient = run(["age-keygen", "-y", str(key)], capture_output=True,
                    text=True).stdout.strip()
    pid = run(["systemctl", "show", args.service, "-p", "MainPID", "--value"],
              capture_output=True, text=True).stdout.strip()
    if not pid.isdigit() or pid == "0":
        raise RuntimeError("website service is not running")
    process_env = {}
    for item in Path("/proc/%s/environ" % pid).read_bytes().split(b"\0"):
        if b"=" in item:
            k, v = item.split(b"=", 1)
            process_env[k.decode()] = v.decode()
    url = urlsplit(process_env.get("DATABASE_URL", ""))
    if url.scheme not in ("postgres", "postgresql") or not url.hostname:
        raise RuntimeError("running process has no PostgreSQL DATABASE_URL")
    pg_env = os.environ.copy()
    pg_env.update(PGHOST=url.hostname, PGPORT=str(url.port or 5432),
                  PGUSER=unquote(url.username or ""),
                  PGPASSWORD=unquote(url.password or ""),
                  PGDATABASE=unquote(url.path.lstrip("/")))
    pg_env["PGAPPNAME"] = "rox-sso-pre-migration-backup"
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = Path(args.base_dir) / ("pocket-sso-" + stamp)
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    pg_dump = "/usr/lib/postgresql/17/bin/pg_dump"
    encrypt_pipeline([pg_dump, "--format=custom", "--no-password"],
                     destination / "rox_prod.dump.age", recipient, pg_env)
    paths = ["/etc/rox-one-website.env", "/etc/rox-one-website.postgres.env",
             "/etc/rox-one-website.tbank-production.env",
             "/etc/systemd/system/rox-one-website.service", "/etc/nginx",
             "/etc/letsencrypt", "/opt/rox-one/current"]
    paths = [p for p in paths if Path(p).exists()]
    encrypt_pipeline(["tar", "-czf", "-", "--"] + paths,
                     destination / "web-config.tar.gz.age", recipient)
    # Read-back verifies age authentication and pg_restore archive parsing.
    decrypted = subprocess.Popen(["age", "-d", "-i", str(key),
                                  str(destination / "rox_prod.dump.age")],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    restored = subprocess.Popen(["/usr/lib/postgresql/17/bin/pg_restore", "--list"],
                                stdin=decrypted.stdout, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE)
    decrypted.stdout.close()
    listing, _ = restored.communicate()
    _, _ = decrypted.communicate()
    if restored.returncode or decrypted.returncode:
        raise RuntimeError("encrypted database read-back failed")
    manifest = {"createdAt": stamp, "service": args.service,
                "releasePath": str(Path("/opt/rox-one/current").resolve()),
                "database": {"host": url.hostname, "port": url.port or 5432,
                             "name": pg_env["PGDATABASE"]},
                "recoveryKeyPath": str(key), "recipient": recipient,
                "archiveReadback": "age decrypt and pg_restore --list passed",
                "archiveEntryCount": sum(1 for row in listing.splitlines()
                                         if row and not row.startswith(b";")),
                "files": {p.name: {"sha256": digest(p), "bytes": p.stat().st_size}
                          for p in destination.iterdir() if p.is_file()}}
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"backupPath": str(destination), "manifest": manifest}))


if __name__ == "__main__":
    main()
