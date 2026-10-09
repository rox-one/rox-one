# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "pyhindsight>=20260600",
#   "click>=8.3,<9",
#   "ccl_chromium_reader @ git+https://github.com/cclgroupltd/ccl_chromium_reader.git",
# ]
# ///
"""Browser Intelligence Hindsight runner.

Wraps pyhindsight's CLI behind one stable entrypoint so the pipeline can invoke
it through the bundled uv wrapper. The argv shape mirrors `hindsight.py`
(`-i/-o/-f/-b/-l`, `--log-level`, `--nocopy`, `--only`) so the wrapper is a true
drop-in replacement for the native CLI. The contract is machine-friendly: stdout
carries a single JSON receipt, every diagnostic stays on stderr, and a failed
run always exits non-zero instead of looking like an empty success.

Only `-f sqlite` produces the row counts in the receipt; `jsonl`/`xlsx` runs
still execute and report the output path/bytes/duration but omit the counts.

Published pyhindsight releases install the setuptools scripts `hindsight.py` /
`hindsight_gui.py` (there is no `hindsight` console script yet) and their CLI
accepts only `-i -o -b -f -l -t -d -c --nocopy --temp_dir`. Flags this runner
accepts for contract stability but that the installed build does not implement
(`--only`, `--log-level`) are reported on stderr instead of being forwarded.

Usage:
    uv run hindsight_runner.py -i PROFILE_DIR -o BASE [-f sqlite] [OPTIONS]
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import click
from click.core import ParameterSource

RUNNER_VERSION = "1.0.0"
DEFAULT_TIMEOUT_SECONDS = 900
STDERR_TAIL_LINES = 40
BROWSER_TYPES = ("Chrome", "Edge", "Brave", "Vivaldi", "Firefox", "Tor")
LOG_LEVELS = ("debug", "info", "warning", "error")
OUTPUT_FORMATS = ("sqlite", "jsonl", "xlsx")


def _is_self_wrapper(candidate: Path) -> bool:
    """True when `candidate` is this tool's own ROX wrapper, not pyhindsight.

    The ROX bin dir sits on PATH and holds a `hindsight` wrapper, so a bare
    `which('hindsight')` would resolve that wrapper and re-exec this runner
    forever. The wrapper is the only candidate whose body references us.
    """
    try:
        return b"hindsight_runner.py" in candidate.read_bytes()[:400]
    except OSError:
        return False


def _candidates(name: str) -> list[Path]:
    """Resolved locations for `name`: PATH first, then next to this interpreter."""
    found: list[Path] = []
    which = shutil.which(name)
    if which:
        found.append(Path(which))
    sibling = Path(sys.executable).parent / name
    if sibling.exists():
        found.append(sibling)
    return found


def resolve_hindsight() -> str | None:
    """Locate pyhindsight's entry script inside the PEP 723 environment.

    uv puts the environment's bin dir first on PATH. Releases so far expose only
    the `hindsight.py` script, so the console-script name is probed first (in
    case it appears later) and the script name second.
    """
    names = ("hindsight.exe", "hindsight", "hindsight.py") if os.name == "nt" else ("hindsight", "hindsight.py")
    for name in names:
        for candidate in _candidates(name):
            if not _is_self_wrapper(candidate):
                return str(candidate)
    return None


def _tail(text: str, lines: int = STDERR_TAIL_LINES) -> str:
    """Last `lines` lines of `text`, trimmed of trailing blank lines."""
    stripped = text.strip("\n")
    if not stripped:
        return ""
    return "\n".join(stripped.splitlines()[-lines:])


def count_timeline(sqlite_path: Path) -> tuple[int, int, int]:
    """Return (profiles, visits, bookmarks) from the produced timeline table.

    A missing table or column is normal for empty/partial runs and reports 0
    rather than failing the whole invocation.
    """
    try:
        # Read-only URI keeps the produced file untouched; the run already owns it.
        con = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    except sqlite3.Error:
        return (0, 0, 0)

    def scalar(query: str) -> int:
        try:
            row = con.cursor().execute(query).fetchone()
        except sqlite3.Error:
            return 0
        return int(row[0] or 0) if row else 0

    try:
        profiles = scalar("SELECT COUNT(DISTINCT profile) FROM timeline WHERE profile IS NOT NULL")
        visits = scalar("SELECT COUNT(*) FROM timeline WHERE type = 'url'")
        bookmarks = scalar("SELECT COUNT(*) FROM timeline WHERE type LIKE 'bookmark%'")
        return (profiles, visits, bookmarks)
    finally:
        con.close()


@click.command()
@click.option("-i", "--input", "input_path", type=click.Path(exists=True, file_okay=False), default=None,
              help="Browser profile directory, or a parent directory of several profiles.")
@click.option("-o", "--output", "output_base", type=click.Path(), default=None,
              help="Base path for Hindsight's output; the format's extension is appended.")
@click.option("-f", "--format", "output_format", type=click.Choice(OUTPUT_FORMATS, case_sensitive=False),
              default="sqlite", show_default=True, help="Hindsight output format.")
@click.option("-b", "--browser-type", type=click.Choice(BROWSER_TYPES, case_sensitive=False), default=None,
              help="Force one browser type for every profile instead of auto-detecting.")
@click.option("-l", "--log", "log_path", type=click.Path(), default=None,
              help="Hindsight log file path (forwarded to the child's -l).")
@click.option("--only", default=None, metavar="ARTIFACTS",
              help="Artifact filter (accepted for contract stability; ignored by the installed build).")
@click.option("--log-level", type=click.Choice(LOG_LEVELS, case_sensitive=False), default="info",
              show_default=True, help="Log verbosity (accepted for contract stability; ignored by the installed build).")
@click.option("--no-copy", "--nocopy", "no_copy", is_flag=True, default=False,
              help="Skip Hindsight's own file copying; staging already isolated the databases.")
@click.option("--timeout", type=click.IntRange(min=1), default=DEFAULT_TIMEOUT_SECONDS,
              show_default=True, help="Hard timeout for the Hindsight subprocess, in seconds.")
@click.option("--check", is_flag=True, default=False,
              help="Resolve the Hindsight executable and report it, then exit.")
@click.option("--version", "show_version", is_flag=True, default=False,
              help="Report the runner version, then exit.")
@click.pass_context
def main(
    ctx: click.Context,
    input_path: str | None,
    output_base: str | None,
    output_format: str,
    browser_type: str | None,
    log_path: str | None,
    only: str | None,
    log_level: str,
    no_copy: bool,
    timeout: int,
    check: bool,
    show_version: bool,
) -> None:
    """Run Hindsight over a staged browser profile and emit a JSON receipt."""
    if show_version:
        click.echo(json.dumps({"ok": True, "runner": "hindsight_runner", "version": RUNNER_VERSION}))
        return

    hindsight = resolve_hindsight()
    if hindsight is None:
        raise click.ClickException(
            "hindsight executable not found; expected the pyhindsight entry script on PATH."
        )

    if check:
        click.echo(json.dumps({"ok": True, "hindsight": hindsight}))
        return

    if not input_path:
        raise click.ClickException("--input is required.")
    if not output_base:
        raise click.ClickException("--output is required.")

    fmt = output_format.lower()
    # Hindsight resolves relative -o/-l against its own script directory, not the
    # CWD, so both paths must be absolute before they cross the process edge.
    output_abs = str(Path(output_base).expanduser().resolve())

    if only:
        click.echo("Warning: installed pyhindsight has no --only flag; artifact filter ignored.", err=True)
    if ctx.get_parameter_source("log_level") is ParameterSource.COMMANDLINE:
        click.echo("Warning: installed pyhindsight has no --log-level flag; log level ignored.", err=True)

    argv = [hindsight, "-i", input_path, "-o", output_abs, "-f", fmt]
    # Setuptools installs the entry as a bare `.py` script, so it needs the
    # environment interpreter rather than relying on the OS file association.
    if hindsight.lower().endswith(".py"):
        argv.insert(0, sys.executable)
    if browser_type:
        argv += ["-b", browser_type]
    if log_path:
        argv += ["-l", str(Path(log_path).expanduser().resolve())]
    if no_copy:
        argv += ["--nocopy"]

    start = time.monotonic()
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise click.ClickException(f"hindsight timed out after {timeout}s.")
    duration_ms = int((time.monotonic() - start) * 1000)

    if proc.returncode != 0:
        detail = _tail(proc.stderr or "") or _tail(proc.stdout or "")
        raise click.ClickException(f"hindsight failed (exit {proc.returncode}):\n{detail}")

    receipt_path = Path(f"{output_abs}.{fmt}")
    if not receipt_path.is_file():
        raise click.ClickException(
            f"hindsight exited 0 but produced no {fmt} output at {receipt_path}."
        )

    receipt = {
        "ok": True,
        "output": str(receipt_path),
        "bytes": receipt_path.stat().st_size,
        "duration_ms": duration_ms,
    }
    # Row counts only come from the timeline table, which exists in sqlite output.
    if fmt == "sqlite":
        profiles, visits, bookmarks = count_timeline(receipt_path)
        receipt["profiles"] = profiles
        receipt["visits"] = visits
        receipt["bookmarks"] = bookmarks
    click.echo(json.dumps(receipt))


if __name__ == "__main__":
    main()