from __future__ import annotations

import codecs
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Mapping, Sequence

from .copies import CookbookCopy
from .notebooks import persist_code_output
from .secrets import redact_output, redact_output_stream, rewrite_missing_secret_error


class KernelError(RuntimeError):
    pass


KERNEL_LANGUAGES: tuple[str, ...] = ("python",)


def languages() -> tuple[str, ...]:
    """Kernel languages the Lab can offer.

    Spec A9 / non-goals: only Python. R, JavaScript and Julia kernels are out of
    scope, so this tuple is the single place that decides what the host may offer.
    """
    return KERNEL_LANGUAGES


# Spec req 10 / failure table "No Python": the Lab only offers CPython >= 3.11.
MIN_PYTHON: tuple[int, int] = (3, 11)
DEFAULT_INTERPRETER_NAMES: tuple[str, ...] = (
    "python3.14",
    "python3.13",
    "python3.12",
    "python3.11",
    "python3.10",
    "python3",
    "python",
)
_VENV_MARKER = ".rox-install.json"
_VERSION_PROBE = "import json,sys;print(json.dumps(list(sys.version_info[:3])))"
_VERSION_LABEL = re.compile(r"^(\d{1,2})(?:\.(\d{1,2}))?(?:\.(\d{1,2}))?$")


class InstallError(KernelError):
    """A ``venv``/``pip`` command exited non-zero."""


RETRYABLE_ERRORS: tuple[type[BaseException], ...] = (
    KernelError,
    subprocess.SubprocessError,
    OSError,
)


# Plan 010: a cell's stdout/stderr is capped before it is returned or persisted,
# so a runaway ``print`` cannot exhaust host memory or bloat the ipynb unbounded.
MAX_CAPTURE_CHARS = 200_000

# Plan 010: the environment a child process may see. Every other host variable is
# deliberately withheld, so an *undeclared* host credential cannot be read (and
# therefore printed into a notebook) by a cell. Adding a name here is a security
# decision; see the maintenance note in plans/010-kernel-output-safety.md.
_CHILD_ENV_ALLOWLIST: tuple[str, ...] = (
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "PYTHONIOENCODING",
    "PYTHONUTF8",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
)

# Plan 010: pip options a cookbook requirements.txt is not allowed to set, because
# they redirect where packages are fetched from. Other ``-`` options pass through.
_BLOCKED_REQUIREMENT_OPTIONS: frozenset[str] = frozenset(
    {"-i", "--index-url", "--extra-index-url", "--find-links", "-f", "--trusted-host", "--host"}
)


def _subprocess_env(extra: Mapping[str, str] | None = None) -> dict[str, str]:
    """The environment for a child process: an allowlist, never ``os.environ``.

    ``extra`` is layered on top, so a copy's declared secrets still reach its cell
    while an undeclared host variable does not.
    """
    env = {name: os.environ[name] for name in _CHILD_ENV_ALLOWLIST if name in os.environ}
    if extra:
        env.update({str(key): str(value) for key, value in extra.items()})
    return env


def _cap_output(text: str) -> str:
    """Truncate a captured stream to ``MAX_CAPTURE_CHARS`` with a visible marker."""
    if len(text) <= MAX_CAPTURE_CHARS:
        return text
    omitted = len(text) - MAX_CAPTURE_CHARS
    return text[:MAX_CAPTURE_CHARS] + f"\n…[truncated: {omitted} chars omitted]"


@dataclass(frozen=True)
class PythonInterpreter:
    """A local CPython the Lab may build a copy venv with.

    ``path`` is the executable to spawn; ``version`` its probed
    ``sys.version_info[:3]``, so a candidate is only reported once it has
    actually answered a version probe.
    """

    path: Path
    version: tuple[int, int, int]

    @property
    def version_string(self) -> str:
        return ".".join(str(part) for part in self.version)

    @property
    def major_minor(self) -> str:
        return ".".join(str(part) for part in self.version[:2])

    @property
    def label(self) -> str:
        return f"Python {self.version_string} ({self.path})"

    def satisfies(self, minimum) -> bool:
        return self.version >= _normalize_version(minimum)

    def __str__(self) -> str:
        return str(self.path)

    def as_dict(self) -> dict:
        return {"path": str(self.path), "version": self.version_string, "label": self.label}


def parse_version_label(value) -> tuple[int, ...] | None:
    """``"3.11"``/``"3.12.4"`` -> ``(3, 11)``/``(3, 12, 4)``; ``None`` otherwise."""
    match = _VERSION_LABEL.match(str(value).strip())
    if not match:
        return None
    return tuple(int(group) for group in match.groups() if group is not None)


def _normalize_version(value) -> tuple[int, int, int]:
    if isinstance(value, str):
        parsed = parse_version_label(value)
        if parsed is None:
            raise KernelError(f"unrecognized Python version: {value!r}")
        value = parsed
    parts = tuple(int(part) for part in value)
    if not parts:
        raise KernelError("empty Python version")
    return (parts + (0, 0, 0))[:3]


def _interpreter_dirs() -> tuple[Path, ...]:
    """Usual per-user/system install locations, so a GUI app can find Python
    even when it was launched without the user's shell ``PATH``."""
    home = Path.home()
    dirs = [
        Path("/opt/homebrew/bin"),
        Path("/usr/local/bin"),
        Path("/usr/bin"),
        Path("/opt/homebrew/opt/python/bin"),
        home / ".local" / "bin",
        home / ".pyenv" / "shims",
    ]
    local_appdata = os.environ.get("LOCALAPPDATA")
    if local_appdata:
        programs = Path(local_appdata) / "Programs" / "Python"
        dirs.append(programs)
        dirs.extend(sorted(child for child in programs.glob("Python*") if child.is_dir()))
    return tuple(dirs)


def _probe_version(executable: Path, *, timeout: float = 10.0) -> tuple[int, int, int] | None:
    """``sys.version_info[:3]`` of ``executable``, or ``None`` if it is not Python."""
    try:
        proc = subprocess.run(
            [str(executable), "-c", _VERSION_PROBE],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    lines = (proc.stdout or "").strip().splitlines()
    if not lines:
        return None
    try:
        parts = json.loads(lines[-1])
        return _normalize_version(parts)
    except (ValueError, TypeError, KernelError):
        return None


def discover_interpreters(
    *,
    path: str | None = None,
    names: Sequence[str] | None = None,
    extra_dirs: Iterable[str | Path] = (),
    min_version: tuple | str | None = MIN_PYTHON,
    include: Iterable[str | Path] = (),
    timeout: float = 10.0,
) -> list[PythonInterpreter]:
    """Local CPython interpreters at or above ``min_version``, newest first.

    Scans ``names`` on ``path`` (defaults to ``PATH``; ``""`` skips the PATH
    probe), in ``extra_dirs``, in the usual install locations, in ``include``,
    and always the running interpreter. Each candidate is version-probed, so
    shims, broken installs and non-Python files are skipped instead of offered.
    """
    floor = _normalize_version(min_version) if min_version is not None else None
    search_names = tuple(names or DEFAULT_INTERPRETER_NAMES)
    search_path = os.environ.get("PATH", "") if path is None else path
    candidates: list[Path] = []
    if search_path:
        for name in search_names:
            hit = shutil.which(name, path=search_path)
            if hit:
                candidates.append(Path(hit))
    for directory in (*tuple(Path(entry).expanduser() for entry in extra_dirs), *_interpreter_dirs()):
        for name in search_names:
            candidate = directory / name
            if candidate.is_file() and os.access(candidate, os.X_OK):
                candidates.append(candidate)
    for entry in include:
        candidates.append(Path(entry))
    candidates.append(Path(sys.executable))

    found: dict[Path, PythonInterpreter] = {}
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:  # pragma: no cover - unreadable path
            continue
        if resolved in found:
            continue
        version = _probe_version(resolved, timeout=timeout)
        if version is None:
            continue
        interpreter = PythonInterpreter(resolved, version)
        if floor is not None and not interpreter.satisfies(floor):
            continue
        found[resolved] = interpreter
    return sorted(
        found.values(),
        key=lambda item: (-item.version[0], -item.version[1], -item.version[2], str(item.path)),
    )


def discover_pythons(
    *,
    path: str | None = None,
    min_version: tuple | str | None = MIN_PYTHON,
    extra_dirs: Iterable[str | Path] = (),
    include: Iterable[str | Path] = (),
) -> list[str]:
    """Paths of the interpreters the venv picker may offer, newest first."""
    return [
        str(interpreter.path)
        for interpreter in discover_interpreters(
            path=path, min_version=min_version, extra_dirs=extra_dirs, include=include
        )
    ]


def _no_python_message(wanted: str, pool: Iterable[PythonInterpreter]) -> str:
    known = ", ".join(sorted({item.version_string for item in pool})) or "none"
    return (
        f"no {wanted} interpreter found (versions seen: {known}). "
        "Install Python 3.11+ from https://www.python.org/downloads/ and reopen the cookbook."
    )


def pick_python(
    *,
    version: str | None = None,
    minimum: tuple | str | None = MIN_PYTHON,
    candidates: Iterable[PythonInterpreter] | None = None,
    fallback: PythonInterpreter | None = None,
) -> PythonInterpreter:
    """Choose the interpreter to build a venv with (spec req 10).

    ``version`` pins a major[.minor[.patch]] (``"3.11"``); otherwise the newest
    candidate at or above ``minimum`` wins. ``fallback`` is returned instead of
    raising when the machine has no qualifying Python at all.
    """
    floor = _normalize_version(minimum) if minimum is not None else None
    pool = list(candidates) if candidates is not None else discover_interpreters(min_version=floor)
    if floor is not None:
        pool = [item for item in pool if item.satisfies(floor)]
    if version is not None:
        wanted = parse_version_label(version)
        if wanted is None:
            raise KernelError(
                f"unrecognized Python version {version!r}; pass e.g. '3.11' or a path to python"
            )
        matches = [item for item in pool if item.version[: len(wanted)] == wanted]
        if not matches:
            raise KernelError(_no_python_message(f"Python {version}", pool))
        return max(matches, key=lambda item: (item.version, str(item.path)))
    if not pool:
        if fallback is not None:
            return fallback
        floor_label = ".".join(str(part) for part in (floor or MIN_PYTHON))
        raise KernelError(_no_python_message(f"Python >= {floor_label}", pool))
    return max(pool, key=lambda item: (item.version, str(item.path)))


@dataclass(frozen=True)
class RequirementsSpec:
    """A parsed ``requirements.txt``: packages plus the pip options it sets."""

    requirements: tuple[str, ...]
    options: tuple[str, ...]
    sources: tuple[Path, ...] = ()

    def fingerprint(self, python) -> str:
        """Identity of "what must be installed, for which interpreter"."""
        payload = json.dumps(
            {"python": str(python), "requirements": self.requirements, "options": self.options},
            sort_keys=True,
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def parse_requirements(source: Path | str | Iterable[str]) -> RequirementsSpec:
    """Parse a requirements file the way pip does.

    Blank lines and ``#`` comments are dropped (inline ones too); ``-r``/
    ``--requirement`` includes are followed relative to the including file;
    every other ``-`` line (``--no-index``, ``--find-links``, ...) is kept in
    ``options`` and handed to pip verbatim. A missing file yields an empty
    spec, which matches catalog items that declare no ``python.dependencies``.
    """
    requirements: list[str] = []
    options: list[str] = []
    sources: list[Path] = []
    if isinstance(source, (str, Path)):
        path = Path(source)
        if not path.is_file():
            return RequirementsSpec((), ())
        lines = path.read_text(encoding="utf-8").splitlines()
        base = path.resolve()
        sources.append(base)
        base_dir = base.parent
    else:
        lines = [str(line) for line in source]
        base_dir = Path.cwd()
    _collect_requirements(lines, base_dir, requirements, options, sources, {p.resolve() for p in sources})
    return RequirementsSpec(tuple(requirements), tuple(options), tuple(sources))


def _collect_requirements(
    lines: Iterable[str],
    base_dir: Path,
    requirements: list[str],
    options: list[str],
    sources: list[Path],
    seen: set[Path],
) -> None:
    for raw in lines:
        line = re.split(r"\s+#", raw, maxsplit=1)[0].strip()
        if not line or line.startswith("#"):
            continue
        included = _include_target(line)
        if included is not None:
            target = Path(included).expanduser()
            if not target.is_absolute():
                target = base_dir / target
            resolved = target.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            if not resolved.is_file():
                raise KernelError(f"requirements include not found: {included} (from {base_dir})")
            sources.append(resolved)
            _collect_requirements(
                resolved.read_text(encoding="utf-8").splitlines(),
                resolved.parent,
                requirements,
                options,
                sources,
                seen,
            )
            continue
        if line.startswith("-"):
            options.append(line)
        else:
            requirements.append(line)


def _include_target(line: str) -> str | None:
    """The path in ``-r x``/``-rx``/``--requirement x``/``--requirement=x``."""
    for flag in ("--requirement", "-r"):
        if line == flag:
            return None
        for separator in (" ", "="):
            prefix = flag + separator
            if line.startswith(prefix):
                return line[len(prefix) :].strip().strip("\"'")
        if flag == "-r" and line.startswith("-r") and line[2] not in "- ":
            return line[2:].strip().strip("\"'")
    return None


def run_with_retries(
    func: Callable[[int], object],
    *,
    attempts: int = 3,
    delay: float = 0.0,
    backoff: float = 2.0,
    retry_on: tuple[type[BaseException], ...] = RETRYABLE_ERRORS,
    on_retry: Callable[[int, BaseException], None] | None = None,
):
    """Call ``func(attempt)`` (1-based) until it succeeds.

    Only ``retry_on`` failures are retried; ``delay`` seconds pass before the
    first retry and ``backoff`` multiplies it for each further one. The last
    failure is re-raised unchanged, so callers keep the original exception type
    and can attach the accumulated log themselves.
    """
    if attempts < 1:
        raise ValueError("attempts must be >= 1")
    attempt = 0
    while True:
        attempt += 1
        try:
            return func(attempt)
        except retry_on as exc:
            if on_retry is not None:
                on_retry(attempt, exc)
            if attempt >= attempts:
                raise
            if delay:
                time.sleep(delay * (backoff ** (attempt - 1)))


@dataclass(frozen=True)
class ProvisionResult:
    """Outcome of provisioning one copy: venv interpreter plus the install log."""

    python: Path
    venv_dir: Path
    created: bool
    interpreter: PythonInterpreter | None
    requirements: tuple[str, ...]
    options: tuple[str, ...]
    pip_argv: tuple[str, ...]
    installed: bool
    skipped_reason: str | None
    attempts: int
    returncode: int | None
    log: str
    log_path: Path | None = None

    def as_dict(self) -> dict:
        return {
            "python": str(self.python),
            "venvDir": str(self.venv_dir),
            "created": self.created,
            "interpreter": self.interpreter.as_dict() if self.interpreter else None,
            "requirements": list(self.requirements),
            "options": list(self.options),
            "pipArgv": list(self.pip_argv),
            "installed": self.installed,
            "skippedReason": self.skipped_reason,
            "attempts": self.attempts,
            "returncode": self.returncode,
            "log": self.log,
            "logPath": str(self.log_path) if self.log_path else None,
        }


def _reject_blocked_options(options: Iterable[str]) -> None:
    """Refuse pip options that would redirect package downloads (plan 010)."""
    for option in options:
        flag = re.split(r"[=\s]", option.strip(), maxsplit=1)[0]
        if flag in _BLOCKED_REQUIREMENT_OPTIONS:
            raise InstallError(f"requirements option not allowed: {option}")


def install_requirements(
    copy: CookbookCopy,
    python: str | None = None,
    *,
    requirements: RequirementsSpec | Path | str | Iterable[str] | None = None,
    attempts: int = 2,
    retry_delay: float = 1.0,
    fallback: bool = True,
    force: bool = False,
    log_path: Path | str | None = None,
    env: Mapping[str, str] | None = None,
    timeout: float = 900.0,
) -> ProvisionResult:
    """Create the copy venv if needed and ``pip install`` its requirements.

    The returned ``log`` is the visible install log (venv creation plus every
    pip attempt, including failures). pip is only run when the requirement set
    or the venv interpreter changed, unless ``force`` is set; ``pip_argv`` is
    the exact command so the UI can show it on failure.
    """
    if isinstance(requirements, RequirementsSpec):
        spec = requirements
    else:
        spec = parse_requirements(
            requirements if requirements is not None else copy.requirements_path
        )
    _reject_blocked_options(spec.options)
    py, created, interpreter, venv_log = _ensure_venv_dir(
        copy, python, fallback=fallback, env=env, timeout=timeout
    )
    log_chunks: list[str] = [venv_log] if venv_log else []
    marker_path = copy.venv_path / _VENV_MARKER
    written_log = Path(log_path) if log_path else None

    def build(**override) -> ProvisionResult:
        fields = dict(
            python=py,
            venv_dir=copy.venv_path,
            created=created,
            interpreter=interpreter,
            requirements=spec.requirements,
            options=spec.options,
            pip_argv=(),
            installed=False,
            skipped_reason=None,
            attempts=0,
            returncode=None,
            log="".join(log_chunks),
            log_path=written_log,
        )
        fields.update(override)
        return ProvisionResult(**fields)

    if not spec.requirements:
        return build(skipped_reason="no requirements declared")

    # Serialize "read marker -> pip install -> write marker" per venv, so two
    # callers cannot both install into (and both write) one venv. Taken after
    # `_ensure_venv_dir` released its lock: the two are sequential, never nested.
    with _venv_lock(copy.venv_path):
        fingerprint = spec.fingerprint(py)
        if not force and _marker_fingerprint(marker_path) == fingerprint:
            return build(skipped_reason="requirements already installed")

        argv = (
            str(py),
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--no-input",
            *spec.options,
            *spec.requirements,
        )
        proc_env = _subprocess_env(env)
        failures: list[BaseException] = []

        def run_pip(attempt: int):
            log_chunks.append(f"$ {' '.join(argv)}  [attempt {attempt}/{attempts}]\n")
            proc = subprocess.run(
                list(argv),
                capture_output=True,
                text=True,
                errors="replace",
                cwd=str(copy.root),
                env=proc_env,
                timeout=timeout,
            )
            piece = (proc.stdout or "") + (proc.stderr or "")
            log_chunks.append(piece if piece.endswith("\n") or not piece else piece + "\n")
            if proc.returncode != 0:
                raise InstallError(f"pip install failed (exit code {proc.returncode})")
            return proc

        def note_retry(attempt: int, exc: BaseException) -> None:
            failures.append(exc)
            log_chunks.append(f"attempt {attempt} failed: {exc}\n")

        try:
            proc = run_with_retries(
                run_pip, attempts=attempts, delay=retry_delay, on_retry=note_retry
            )
        except InstallError as exc:
            log = "".join(log_chunks)
            _write_log(written_log, log)
            raise KernelError(
                f"pip install failed after {attempts} attempt(s): {exc}\n"
                f"command: {' '.join(argv)}\n{log}"
            ) from exc

        _write_marker(marker_path, fingerprint, spec, py)
        log = "".join(log_chunks)
        _write_log(written_log, log)
        return build(
            pip_argv=tuple(argv),
            installed=True,
            attempts=len(failures) + 1,
            returncode=proc.returncode,
            log=log,
        )


def _running_interpreter() -> PythonInterpreter:
    return PythonInterpreter(
        Path(sys.executable).resolve(), tuple(int(part) for part in sys.version_info[:3])
    )


def _resolve_interpreter(python: str | None) -> PythonInterpreter:
    """Accept ``None`` (pick automatically), a path/name, or a "3.11" label."""
    if python is None or not str(python).strip():
        found = discover_interpreters(min_version=MIN_PYTHON)
        return found[0] if found else _running_interpreter()
    text = str(python).strip()
    on_path = shutil.which(text)
    candidate = Path(on_path) if on_path else Path(text).expanduser()
    if candidate.is_file():
        version = _probe_version(candidate)
        if version is None:
            raise KernelError(f"{candidate} is not a usable Python interpreter")
        return PythonInterpreter(candidate.resolve(), version)
    if parse_version_label(text) is not None:
        return pick_python(version=text)
    raise KernelError(
        f"Python interpreter not found: {text}. "
        + _no_python_message("Python 3.11+", discover_interpreters(min_version=None))
    )


def _venv_candidates(python: str | None, *, fallback: bool) -> list[PythonInterpreter]:
    primary = _resolve_interpreter(python)
    if not fallback:
        return [primary]
    running = _running_interpreter()
    return [primary] if running.path == primary.path else [primary, running]


def _venv_base_interpreter(venv_dir: Path) -> PythonInterpreter | None:
    """The interpreter that built ``venv_dir``, read back from ``pyvenv.cfg``."""
    try:
        text = (venv_dir / "pyvenv.cfg").read_text(encoding="utf-8")
    except OSError:
        return None
    values: dict[str, str] = {}
    for line in text.splitlines():
        key, separator, value = line.partition("=")
        if separator:
            values[key.strip().lower()] = value.strip()
    version = parse_version_label(values.get("version", ""))
    if version is None:
        return None
    for key in ("executable", "base-executable", "home"):
        raw = values.get(key)
        if not raw:
            continue
        candidate = Path(raw)
        if candidate.is_dir():  # pre-3.11 venvs record the bin directory as ``home``
            candidate = candidate / Path(sys.executable).name
        if candidate.is_file():
            return PythonInterpreter(candidate.resolve(), _normalize_version(version))
    return None


def _write_log(log_path: Path | None, log: str) -> Path | None:
    if log_path is None:
        return None
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(log, encoding="utf-8")
    return log_path


def _marker_fingerprint(marker_path: Path) -> str | None:
    try:
        data = json.loads(marker_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    fingerprint = data.get("fingerprint") if isinstance(data, dict) else None
    return fingerprint if isinstance(fingerprint, str) else None


def _write_marker(
    marker_path: Path, fingerprint: str, spec: RequirementsSpec, python: Path
) -> None:
    marker_path.parent.mkdir(parents=True, exist_ok=True)
    marker_path.write_text(
        json.dumps(
            {
                "fingerprint": fingerprint,
                "python": str(python),
                "requirements": list(spec.requirements),
                "options": list(spec.options),
                "installedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


# One provisioning lock per venv path so two Runs of the same copy cannot build
# or install into one venv at the same time (plan 008). These locks are
# in-process only: a future multi-process host (Electron spawning helper
# processes) would need file-based locks instead. `_VENV_LOCKS_GUARD` is only
# ever held while looking a lock up, never across a subprocess.
_VENV_LOCKS: dict[str, threading.Lock] = {}
_VENV_LOCKS_GUARD = threading.Lock()


def _venv_lock(venv_dir: Path) -> threading.Lock:
    """The shared provisioning lock for ``venv_dir``, created on first use."""
    key = str(Path(venv_dir).resolve())
    with _VENV_LOCKS_GUARD:
        lock = _VENV_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _VENV_LOCKS[key] = lock
        return lock


def _create_venv(
    venv_dir: Path,
    candidates: Sequence[PythonInterpreter],
    *,
    env: Mapping[str, str] | None,
    timeout: float,
) -> tuple[PythonInterpreter, str]:
    """Build ``venv_dir`` with the first candidate that can; return it and the log."""
    proc_env = _subprocess_env(env)
    log_chunks: list[str] = []
    for index, candidate in enumerate(candidates):
        shutil.rmtree(venv_dir, ignore_errors=True)  # drop a half-built venv
        log_chunks.append(f"$ {candidate.path} -m venv {venv_dir}\n")
        try:
            proc = subprocess.run(
                [str(candidate.path), "-m", "venv", str(venv_dir)],
                capture_output=True,
                text=True,
                errors="replace",
                env=proc_env,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as exc:
            log_chunks.append((exc.stdout or "") + (exc.stderr or "") + f"timed out after {timeout:g}s\n")
        except OSError as exc:
            log_chunks.append(f"{exc}\n")
        else:
            log_chunks.append((proc.stdout or "") + (proc.stderr or ""))
            if proc.returncode == 0 and _venv_python(venv_dir).exists():
                log_chunks.append(f"created venv with {candidate.label}\n")
                return candidate, "".join(log_chunks)
            detail = (
                f"exit code {proc.returncode}"
                if proc.returncode
                else "no interpreter in the venv after creation"
            )
            log_chunks.append(f"venv creation with {candidate.path} failed: {detail}\n")
        if index + 1 < len(candidates):
            log_chunks.append(f"trying {candidates[index + 1].path} next\n")
    raise KernelError(
        "could not create a virtual environment for this cookbook; "
        "install Python 3.11+ from https://www.python.org/downloads/ and retry\n"
        + "".join(log_chunks)
    )


def _ensure_venv_dir(
    copy: CookbookCopy,
    python: str | None,
    *,
    fallback: bool = True,
    env: Mapping[str, str] | None = None,
    timeout: float = 900.0,
) -> tuple[Path, bool, PythonInterpreter, str]:
    """``(venv python, created, base interpreter, log)``; reuses an existing venv."""
    venv_dir = copy.venv_path
    if not _venv_python(venv_dir).exists():
        with _venv_lock(venv_dir):
            # Double-checked: another Run may have built the venv while we waited.
            if not _venv_python(venv_dir).exists():
                interpreter, log = _create_venv(
                    venv_dir,
                    _venv_candidates(python, fallback=fallback),
                    env=env,
                    timeout=timeout,
                )
                return _venv_python(venv_dir), True, interpreter, log
    py = _venv_python(venv_dir)
    interpreter = _venv_base_interpreter(venv_dir) or _running_interpreter()
    return py, False, interpreter, f"reusing venv {venv_dir} ({interpreter.label})\n"


def _venv_python(venv_dir: Path) -> Path:
    if os.name == "nt":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def ensure_venv(
    copy: CookbookCopy,
    python: str | None = None,
    *,
    retry: bool = True,
    attempts: int = 2,
    retry_delay: float = 1.0,
    install: bool = True,
    fallback: bool = True,
    env: Mapping[str, str] | None = None,
) -> tuple[Path, str]:
    """Create (or reuse) the copy venv and install its declared requirements.

    ``python`` is ``None`` to pick the newest discovered Python >= 3.11, a path
    to an interpreter, or a ``"3.11"``-style version. Returns
    ``(venv_python, log)`` so the caller can show the install log; ``retry`` is
    kept as "allow more than one pip attempt" for existing callers.
    """
    if not install:
        py, _created, _interpreter, log = _ensure_venv_dir(
            copy, python, fallback=fallback, env=env
        )
        return py, log
    result = install_requirements(
        copy,
        python,
        attempts=attempts if retry else 1,
        retry_delay=retry_delay,
        fallback=fallback,
        env=env,
    )
    return result.python, result.log


# Wave 11: rich output (plans/cookbooks-surface/SPEC-wave11-rich-output.md). A
# cell may return ``display_data`` records — through the injected ``display()``
# builtin, an object's ``_repr_*_`` methods, or the value of its last top-level
# expression (Jupyter/Colab ``Out[]`` semantics) — plus every matplotlib figure
# still open when the cell ends. Records travel back over a temp results file (a
# "shadow" transport, like the run-all driver's): a killed child leaves no file
# and the caller reports no displays (decisions 1-8).
#
# ``_DISPLAY_HELPERS`` is the single source of truth for the record format, the
# caps, the redaction policy and the matplotlib flush. It is prepended to BOTH
# children: ``_RUNNER`` (one cell per process) and ``_RUN_ALL_DRIVER`` (every
# cell of a copy in one namespace). It must stay Python 3.9-compatible: the Lab
# runs on 3.11+, but PROVENANCE.md validates the vendored snapshot with 3.9.6.
_DISPLAY_RECORD_LIMIT = 512 * 1024  # 512 KiB of data per record
_DISPLAY_CELL_LIMIT = 1536 * 1024  # 1.5 MiB of data per cell / per /run
_DISPLAY_RECORDS_LIMIT = 12  # records per cell / per /run
_DISPLAY_RUN_ALL_LIMIT = 8 * 1024 * 1024  # 8 MiB across one /run-all
_DISPLAY_TRUNCATION_MARKER = "\u2026[display output truncated]"

_DISPLAY_HELPERS = (
    "import base64, io, json, os, re, sys\n"
    "\n"
    f"RECORD_LIMIT = {_DISPLAY_RECORD_LIMIT}\n"
    f"CELL_LIMIT = {_DISPLAY_CELL_LIMIT}\n"
    f"RECORDS_LIMIT = {_DISPLAY_RECORDS_LIMIT}\n"
    f"RUN_ALL_LIMIT = {_DISPLAY_RUN_ALL_LIMIT}\n"
    f"TRUNCATION = {_DISPLAY_TRUNCATION_MARKER!r}\n"
    + """TEXT_MIMES = frozenset(["application/json", "application/xml", "application/x-yaml"])
# One event = one widget representation (Jupyter/Colab). The order below is the
# emission PRIORITY and the single source of truth for it (G3-2): an event picks
# the first mime it has, and the other mimes stay out of the transport.
REPR_MIMES = (
    ("text/html", "_repr_html_"),
    ("image/svg+xml", "_repr_svg_"),
    ("image/png", "_repr_png_"),
    ("image/jpeg", "_repr_jpeg_"),
    ("text/markdown", "_repr_markdown_"),
    ("application/json", "_repr_json_"),
)
WIDGET_MIMES = tuple(mime for mime, _repr in REPR_MIMES)
# G3-3/G3-5: the transport carries these mimes only. A caller-supplied bundle can
# smuggle mime-like text (or a secret inside the mime itself), so a record whose
# mime does not match is dropped rather than stored under the raw key.
MIME_RE = re.compile(
    r"^(text/[a-z0-9][a-z0-9.+-]*|image/(png|jpeg|svg[+]xml)|application/(json|xml|x-yaml))$"
)


def _rox_widget_mime(mimes):
    # The first mime of an event, by the single priority order above.
    present = set(str(mime).strip().lower() for mime in mimes)
    for mime in WIDGET_MIMES:
        if mime in present:
            return mime
    return None


def _rox_is_text_mime(mime):
    value = (mime or "").strip().lower()
    return value.startswith("text/") or value in TEXT_MIMES


def _rox_new_sink(shared=None):
    # `shared` is the run-all budget, a mutable {"left": <bytes>} shared by every
    # cell of one run, or None for a single /run.
    return {"records": [], "size": 0, "truncated": False, "secrets": [], "shared": shared}


def _rox_configure_secrets(sink, names):
    # Values come from this child's own environment: the caller sends names only,
    # so no secret value is ever written to a job or results file (G4-CBK-01).
    secrets = []
    for name in names or []:
        value = os.environ.get(str(name))
        if value:
            secrets.append(str(value))
    sink["secrets"] = secrets
    return sink


def _rox_redact(value, secrets):
    # Longest-first so a secret that starts with another stays masked whole.
    if not value or not secrets:
        return value
    for secret in sorted({s for s in secrets if s}, key=lambda s: (-len(s), s)):
        value = value.replace(secret, "***")
    return value


def _rox_clip(data, limit):
    raw = data.encode("utf-8")
    if len(raw) <= limit:
        return data
    # Never cut a multi-byte character in half.
    return raw[:limit].decode("utf-8", "ignore")


def _rox_mime_value(mime, value):
    # The one normalisation every record goes through (Jupyter/nbformat
    # conventions):
    #   * bytes -> base64 for image/*, utf-8 text for every other mime
    #     (``_repr_png_`` returns bytes);
    #   * a str for image/svg+xml is markup -> base64 (utf-8);
    #   * a str for any other image/* is already base64 -> passed through
    #     unchanged, so ``display({"image/png": "<b64>"}, raw=True)`` — the
    #     common path — is never encoded twice;
    #   * anything else -> json.dumps (dict/list), str() otherwise.
    kind = str(mime).lower()
    if isinstance(value, (bytes, bytearray)):
        raw = bytes(value)
        if kind.startswith("image/"):
            return base64.b64encode(raw).decode("ascii")
        return raw.decode("utf-8", "replace")
    if isinstance(value, str):
        if kind == "image/svg+xml":
            return base64.b64encode(value.encode("utf-8")).decode("ascii")
        return value
    if isinstance(value, (dict, list)):
        try:
            return json.dumps(value, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            return str(value)
    return str(value)


def _rox_repr(obj):
    try:
        return repr(obj)
    except Exception:
        return "<unrepresentable object>"


def _rox_mime_bundle(obj):
    # One display event = one widget representation, the first the object offers
    # in WIDGET_MIMES order, plus text/plain from repr() as the text fallback.
    # The remaining mimes stay out of the transport (Jupyter/Colab behaviour).
    bundle = []
    for mime, attr in REPR_MIMES:
        method = getattr(obj, attr, None)
        if not callable(method):
            continue
        try:
            value = method()
        except Exception:
            continue
        if value is None:
            continue
        bundle.append((mime, _rox_mime_value(mime, value)))
        break
    bundle.append(("text/plain", _rox_repr(obj)))
    return bundle


def _rox_add(sink, mime, data):
    # The one entry point for every record: format, caps and the text-only
    # redaction policy are decided here, so child and caller cannot drift.
    if not isinstance(mime, str) or not isinstance(data, str):
        return
    # G3-3/G3-5: normalise, mask (a secret could ride in the mime itself) and
    # whitelist; a record outside the set never reaches the notebook.
    mime = _rox_redact(mime.strip().lower(), sink["secrets"])
    if not MIME_RE.match(mime):
        return
    if sink["truncated"]:
        return
    if _rox_is_text_mime(mime):
        data = _rox_redact(data, sink["secrets"])
    size = len(data.encode("utf-8"))
    if len(sink["records"]) >= RECORDS_LIMIT:
        sink["truncated"] = True
        return
    if size > RECORD_LIMIT:
        data = _rox_clip(data, RECORD_LIMIT)
        size = len(data.encode("utf-8"))
        sink["truncated"] = True
    if sink["size"] + size > CELL_LIMIT:
        sink["truncated"] = True
        return
    shared = sink["shared"]
    if shared is not None:
        if shared["left"] - size < 0:
            sink["truncated"] = True
            return
        shared["left"] -= size
    sink["records"].append({"mime": mime, "data": data})
    sink["size"] += size


def _rox_display(sink, objects, raw=False):
    for obj in objects:
        if raw:
            # A ready mime bundle: one event, so the same rule as an object —
            # exactly one widget mime (first present in WIDGET_MIMES order) and
            # the caller's text/plain, if any. Extra mimes are ignored.
            if not hasattr(obj, "items"):
                continue
            bundle = {}
            for mime, value in obj.items():
                bundle[str(mime).strip().lower()] = value
            widget = _rox_widget_mime(bundle)
            if widget is not None and bundle[widget] is not None:
                _rox_add(sink, widget, _rox_mime_value(widget, bundle[widget]))
            if bundle.get("text/plain") is not None:
                _rox_add(sink, "text/plain", _rox_mime_value("text/plain", bundle["text/plain"]))
        elif isinstance(obj, str):
            # Value API: display("caption") shows the caption itself, no quotes.
            # (The trailing-expression path is the one that keeps repr(), so a
            # cell ending in 'x' still reads like Jupyter's Out[].)
            _rox_add(sink, "text/plain", obj)
        else:
            for mime, data in _rox_mime_bundle(obj):
                _rox_add(sink, mime, data)


def _rox_show(sink, obj):
    # The value of the cell's last top-level expression (Jupyter `Out[]`): None is
    # not shown, and everything else takes the full mime bundle — so a trailing
    # 'x' keeps its quotes, unlike display(), whose string shortcut is the value API.
    if obj is None:
        return
    for mime, data in _rox_mime_bundle(obj):
        _rox_add(sink, mime, data)


def _rox_make_display(box):
    # Bound to a mutable box, so a run-all namespace can be reused across cells
    # while every cell still writes into its own sink.
    def display(*objects, raw=False):
        return _rox_display(box["sink"], objects, raw)

    return display


def _rox_make_show(box):
    def __show__(obj):
        return _rox_show(box["sink"], obj)

    return __show__


def _rox_flush_figures(sink):
    # Only when the cell itself pulled in matplotlib.pyplot: the child never
    # imports it, so a plain cell neither pays for matplotlib nor fails without it.
    pyplot = sys.modules.get("matplotlib.pyplot")
    if pyplot is None:
        return
    try:
        numbers = list(pyplot.get_fignums())
    except Exception:
        numbers = []
    for number in numbers:
        try:
            figure = pyplot.figure(number)
            buffer = io.BytesIO()
            figure.savefig(buffer, format="png", bbox_inches="tight")
        except Exception:
            continue
        _rox_add(sink, "image/png", base64.b64encode(buffer.getvalue()).decode("ascii"))
    try:
        pyplot.close("all")
    except Exception:
        pass


def _rox_wrap_last_expression(source, filename="<cell>"):
    # displayhook semantics without compile(mode="single") (which would display
    # every expression and add other surprises): only the LAST top-level
    # expression statement is shown, by rewriting it into a call.
    import ast

    tree = ast.parse(source, filename=filename, mode="exec")
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last = tree.body[-1]
        call = ast.Expr(
            value=ast.Call(
                func=ast.Name(id="__rox_show__", ctx=ast.Load()),
                args=[last.value],
                keywords=[],
            )
        )
        ast.copy_location(call, last)
        tree.body[-1] = call
    ast.fix_missing_locations(tree)
    return compile(tree, filename, "exec")


def _rox_records(sink):
    records = [dict(record) for record in sink["records"]]
    if sink["truncated"]:
        records.append({"mime": "text/plain", "data": TRUNCATION})
    return records


def _rox_write_results(path, sink):
    # tmp + os.replace: the caller never reads a half-written results file.
    payload = {"displays": _rox_records(sink)}
    tmp = str(path) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh)
    os.replace(tmp, path)
"""
)


# Cell runner: one isolated `python -c` per cell. T0 uses this instead of a
# long-lived ZMQ kernel so the spike is testable without jupyter_client. The
# Electron host can swap the transport for ipykernel over 127.0.0.1 + token;
# the copy/venv/env contract below stays the same either way.
#
# Wave 11: stdin is a JSON object ``{"code": <str>, "results": <path|null>,
# "secret_env": [names]}`` — a bare JSON string (the old wire format) is still
# accepted. The child writes ``{"displays": [...]}`` to ``results`` in a
# ``finally``, so a kill/timeout leaves no file and the caller reports no
# displays. ``MPLBACKEND=Agg`` is set before the cell runs, so a cell that
# imports matplotlib never needs a display.
_RUNNER = (
    _DISPLAY_HELPERS
    + "import json,sys,traceback\n"
    "payload=json.loads(sys.stdin.read())\n"
    "if isinstance(payload,dict):\n"
    "    code=payload.get('code') or ''\n"
    "    results=payload.get('results')\n"
    "    secret_names=payload.get('secret_env') or []\n"
    "else:\n"
    "    code=payload if isinstance(payload,str) else ''\n"
    "    results=None\n"
    "    secret_names=[]\n"
    "os.environ.setdefault('MPLBACKEND','Agg')\n"
    "sink=_rox_new_sink()\n"
    "_rox_configure_secrets(sink,secret_names)\n"
    "box={'sink':sink}\n"
    "ns={'display':_rox_make_display(box),'__rox_show__':_rox_make_show(box)}\n"
    "failed=1\n"
    "try:\n"
    "    exec(_rox_wrap_last_expression(code,'<cell>'),ns,ns)\n"
    "    failed=0\n"
    "except Exception:\n"
    "    traceback.print_exc()\n"
    "finally:\n"
    "    _rox_flush_figures(sink)\n"
    "    if results:\n"
    "        _rox_write_results(results,sink)\n"
    "if failed:\n"
    "    sys.exit(1)\n"
)


# Wave 11: the caller re-validates what a child wrote back. The results file
# lives in a temp dir the cell itself could write to, so the host never trusts
# it: every record is checked, the same numeric caps are re-applied and text
# mimes are redacted again (defence in depth — decision 8). ``image/*`` is
# deliberately left alone, matching the child (decision 7). G3: the mime itself
# is normalised + whitelisted here too (see ``_MIME_ALLOWED``).
_DISPLAY_TEXT_MIMES = frozenset({"application/json", "application/xml", "application/x-yaml"})

# G3-3/G3-5, caller side: the same set the child enforces, so a tampered results
# file cannot smuggle an arbitrary key into the notebook's ``display_data``.
_MIME_ALLOWED = re.compile(
    r"^(text/[a-z0-9][a-z0-9.+-]*|image/(png|jpeg|svg[+]xml)|application/(json|xml|x-yaml))$"
)

# G4-F2: a size gate before ANY read of a child-written temp file. Our child
# writes under the caps above, so anything past that budget is sabotage (a cell
# can reach the /run payload through ``sys.modules["__main__"].results``) and
# reading it would let one cell OOM the sidecar. Slack covers JSON overhead.
_DISPLAY_READ_SLACK = 64 * 1024
_DISPLAY_READ_LIMIT = _DISPLAY_CELL_LIMIT + _DISPLAY_READ_SLACK


def _run_all_read_limit(cells: int) -> int:
    """The most our own run-all driver can legitimately write for ``cells`` cells.

    The driver writes each cell's raw streams (it does not cap them itself; the
    caller caps them afterwards, plan 016), so the ceiling is the shared display
    budget plus two ``MAX_CAPTURE_CHARS`` streams per cell, worst-case
    JSON-escaped (6 bytes per char).
    """
    return (
        _DISPLAY_RUN_ALL_LIMIT
        + 2 * max(int(cells), 0) * MAX_CAPTURE_CHARS * 6
        + _DISPLAY_READ_SLACK
    )


def _is_text_mime(mime: str) -> bool:
    value = (mime or "").lower()
    return value.startswith("text/") or value in _DISPLAY_TEXT_MIMES


def _clip_display_text(data: str, limit: int) -> str:
    raw = data.encode("utf-8")
    if len(raw) <= limit:
        return data
    return raw[:limit].decode("utf-8", "ignore")


def _read_temp_json(path, limit: int):
    """Parse a temp JSON file our own child wrote; ``None`` if absent, junk or
    over ``limit`` bytes (the caller then reports no records at all)."""
    try:
        if os.path.getsize(path) > limit:
            return None
        text = Path(path).read_text(encoding="utf-8")
    except OSError:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


def _read_displays(path) -> list:
    """The display records a child wrote; ``[]`` when it wrote none."""
    data = _read_temp_json(path, _DISPLAY_READ_LIMIT)
    records = data.get("displays") if isinstance(data, dict) else None
    if not isinstance(records, list):
        return []
    return records


def _cap_displays(records, secrets, *, shared: dict | None = None) -> list[dict]:
    """Re-apply the child's caps and redaction to records read back from temp.

    ``shared`` is the run-all budget ``{"left": <bytes>}`` shared by every cell
    of one run; ``None`` for a single ``/run``. Anything over a cap — or
    malformed — is dropped, and one ``text/plain`` truncation marker is appended
    in its place, exactly as the child does.
    """
    out: list[dict] = []
    size = 0
    truncated = False
    for record in records if isinstance(records, list) else []:
        if not isinstance(record, dict):
            continue
        mime = record.get("mime")
        data = record.get("data")
        if not isinstance(mime, str) or not isinstance(data, str):
            continue
        mime = redact_output(mime.strip().lower(), secrets)
        if not _MIME_ALLOWED.match(mime):
            continue
        if len(out) >= _DISPLAY_RECORDS_LIMIT:
            truncated = True
            break
        if _is_text_mime(mime):
            data = redact_output(data, secrets)
        length = len(data.encode("utf-8"))
        if length > _DISPLAY_RECORD_LIMIT:
            data = _clip_display_text(data, _DISPLAY_RECORD_LIMIT)
            length = len(data.encode("utf-8"))
            truncated = True
        if size + length > _DISPLAY_CELL_LIMIT:
            truncated = True
            break
        if shared is not None:
            if shared["left"] - length < 0:
                truncated = True
                break
            shared["left"] -= length
        out.append({"mime": mime, "data": data})
        size += length
    if truncated:
        out.append({"mime": "text/plain", "data": _DISPLAY_TRUNCATION_MARKER})
    return out


# Plan 016 "Run all": one child process runs every code cell of a copy, in
# document order, inside a single namespace, so cell 2 sees the names cell 1
# defined (the vendor cookbooks assume this Jupyter behaviour; the one-shot
# `_RUNNER` above cannot). The caller writes a job JSON plus this script into a
# temp dir and reconciles the per-cell records the driver appends after each
# cell — a kill mid-run (overall timeout, interrupt) still yields the records of
# the cells that finished. Protocol: argv[1] is the job JSON path, holding
# ``{"cells": [[index, source], ...], "results": <path>, "timeout": <per-cell>}``.
# Wave 11: it also prepends ``_DISPLAY_HELPERS`` and records each cell's
# ``display_data`` in ``rec["displays"]`` (a fresh sink per cell, one shared 8 MiB
# budget for the whole run, figures flushed in the cell's ``finally``).
_RUN_ALL_DRIVER = _DISPLAY_HELPERS + r'''
import io, json, os, signal, sys, time, traceback

# Wave 15: the driver is ALSO the producer of the live NDJSON frame stream. It
# saves the real stdout before it swaps in per-cell buffers and writes one JSON
# frame per line to that saved stream, so the host can relay per-cell progress
# while the run is still going. `results.json` keeps being written per cell
# exactly as before — the frames are additive (decision 4).
real = sys.stdout

# Per-cell emission cap: once a cell has streamed this many characters
# (stdout + stderr together) the driver stops emitting data and writes exactly
# one truncation frame (decision 6).
FRAME_CAP = 200000


def _frame(obj):
    # One JSON object per line, flushed at once so the host sees it live.
    try:
        real.write(json.dumps(obj, ensure_ascii=False) + "\n")
        real.flush()
    except Exception:
        pass


def _redact(text, secrets):
    # Host-injected secret values must never reach the temp results file: the
    # caller can be killed (cancel/overall timeout) before it gets to redact the
    # records itself, so masking happens here, before every write. Longest-first
    # so a secret that starts with another stays masked whole (secrets policy).
    for value in sorted({v for v in secrets if v}, key=lambda s: (-len(s), s)):
        text = text.replace(value, "***")
    return text


class _CellStream(io.StringIO):
    # A per-cell stdout/stderr (decision 4): `getvalue()` stays the FULL raw
    # capture (the record is redacted from it, exactly as before), while `write`
    # also tees whole, already-masked lines out as frames. A secret split over a
    # write boundary is held: only complete lines are released, and only up to
    # the safe prefix (max secret length - 1 chars of margin). The `finish()`
    # tail release at cell end masks whatever is still buffered.
    def __init__(self, index, kind, secrets, budget):
        io.StringIO.__init__(self)
        self._index = index
        self._kind = kind
        self._secrets = [value for value in secrets if value]
        holdback = max((len(value) for value in self._secrets), default=0) - 1
        self._holdback = holdback if holdback > 0 else 0
        self._buf = ""
        self._budget = budget

    def write(self, text):
        written = io.StringIO.write(self, text)
        if not text:
            return written
        budget = self._budget
        if budget["capped"]:
            budget["dropped"] += len(text)
            return written
        self._buf += text
        limit = len(self._buf) - self._holdback
        if limit <= 0:
            return written
        cut = self._buf.rfind("\n", 0, limit)
        if cut == -1:
            return written
        chunk = self._buf[: cut + 1]
        self._buf = self._buf[cut + 1 :]
        self._emit(chunk)
        return written

    def _emit(self, chunk):
        if not chunk:
            return
        masked = _redact(chunk, self._secrets)
        budget = self._budget
        if budget["capped"]:
            budget["dropped"] += len(masked)
            return
        left = FRAME_CAP - budget["sent"]
        if len(masked) <= left:
            budget["sent"] += len(masked)
            _frame({"t": self._kind, "index": self._index, "data": masked})
            return
        if left > 0:
            _frame({"t": self._kind, "index": self._index, "data": masked[:left]})
            budget["sent"] += left
        budget["dropped"] += len(masked) - left
        budget["capped"] = True

    def finish(self):
        # Cell end: release the held tail (masked, complete or not) and let the
        # caller write the single truncation frame.
        if self._buf:
            chunk = self._buf
            self._buf = ""
            self._emit(chunk)


def _cell_error(rec, per_cell):
    if rec.get("timed_out"):
        return (
            "Kernel cell timed out after %gs and was stopped. "
            "Raise the cell timeout or make the cell shorter." % per_cell
        )
    return rec.get("stderr") or rec.get("stdout") or "Kernel cell failed."


def _write(path, payload):
    # tmp + os.replace: the caller never reads a half-written results file.
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh)
    os.replace(tmp, path)


def main(job_path):
    with open(job_path, encoding="utf-8") as fh:
        job = json.load(fh)
    # The job file has served its purpose; drop it so nothing lingers on disk.
    try:
        os.unlink(job_path)
    except OSError:
        pass
    results_path = job["results"]
    per_cell = float(job.get("timeout") or 0)
    # Values come from our own environment: the caller passes names only, so no
    # secret value is ever written to the job file (G4-CBK-01).
    secret_names = job.get("secret_env") or []
    secrets = [os.environ.get(name) for name in secret_names]
    os.environ.setdefault("MPLBACKEND", "Agg")
    timer = hasattr(signal, "setitimer")

    class CellTimeout(Exception):
        pass

    if timer:
        def _on_alarm(signum, frame):
            raise CellTimeout()

        signal.signal(signal.SIGALRM, _on_alarm)

    records, ns = [], {}
    # One namespace for the whole run (cell 1 sees cell 0's names), but a fresh
    # display sink per cell: the builtins read `box["sink"]` at call time, so a
    # name a cell kept still writes into the current cell's sink.
    shared = {"left": RUN_ALL_LIMIT}
    box = {"sink": None}
    ns["display"] = _rox_make_display(box)
    ns["__rox_show__"] = _rox_make_show(box)
    for index, source in job["cells"]:
        start = time.monotonic()
        sink = _rox_new_sink(shared)
        _rox_configure_secrets(sink, secret_names)
        box["sink"] = sink
        _frame({"t": "cell-start", "index": index})
        # One emission budget per cell, shared by its stdout and stderr streams.
        budget = {"sent": 0, "dropped": 0, "capped": False}
        out = _CellStream(index, "stdout", secrets, budget)
        err = _CellStream(index, "stderr", secrets, budget)
        rec = {"index": index, "ok": False, "stdout": "", "stderr": "",
               "timed_out": False, "duration_ms": 0, "displays": []}
        old = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = out, err
        if timer:
            signal.setitimer(signal.ITIMER_REAL, per_cell)
        try:
            exec(_rox_wrap_last_expression(source, "<cell %d>" % index), ns, ns)
            rec["ok"] = True
        except CellTimeout:
            rec["timed_out"] = True
            err.write("cell timed out after %gs\n" % per_cell)
        except BaseException:
            traceback.print_exc(file=err)
        finally:
            if timer:
                signal.setitimer(signal.ITIMER_REAL, 0)
            sys.stdout, sys.stderr = old
            _rox_flush_figures(sink)
        # Release the held tails, then the ONE truncation frame, if we capped.
        out.finish()
        err.finish()
        if budget["capped"]:
            _frame({
                "t": "stdout",
                "index": index,
                "data": "\n\u2026[truncated: %d chars omitted]" % budget["dropped"],
            })
        # Filled before the record is written, so a kill mid-run keeps the
        # displays of every cell that already finished.
        rec["displays"] = _rox_records(sink)
        rec["stdout"], rec["stderr"] = _redact(out.getvalue(), secrets), _redact(
            err.getvalue(), secrets
        )
        rec["duration_ms"] = int((time.monotonic() - start) * 1000)
        records.append(rec)
        _write(results_path, {"cells": records})
        # The full cell record travels as `cell-end` (frame contract), after the
        # temp write, so a killed run still leaves the records it finished.
        _frame({
            "t": "cell-end",
            "index": index,
            "status": "ok" if rec["ok"] else "error",
            "ok": rec["ok"],
            "timed_out": rec["timed_out"],
            "duration_ms": rec["duration_ms"],
            "returncode": None,
            "error": None if rec["ok"] else _cell_error(rec, per_cell),
            "stdout": rec["stdout"],
            "stderr": rec["stderr"],
            "displays": rec["displays"],
        })
        if not rec["ok"]:
            break
    _write(results_path, {"cells": records})
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
'''


class _FrameSink:
    """Serializes ``emit`` calls and enforces the shared streaming cap (wave 15).

    Both reader threads (stdout/stderr) push fragments here; the sink emits one
    ``{"t": "stdout"|"stderr", "index": index, "data": …}`` frame per fragment
    and holds ``MAX_CAPTURE_CHARS`` *across both streams*: the fragment that
    crosses the cap is cut, later fragments are dropped, and ``marker()`` emits
    the single ``…[truncated: N chars omitted]`` frame once, at the end.
    """

    def __init__(self, emit: Callable[[dict], None], index: int | None,
                 max_chars: int = MAX_CAPTURE_CHARS) -> None:
        self._emit = emit
        self._index = index
        self._max = int(max_chars)
        self._lock = threading.Lock()
        self._sent = 0
        self._dropped = 0
        self._capped = False

    def push(self, kind: str, text: str) -> None:
        if not text:
            return
        with self._lock:
            if self._capped:
                self._dropped += len(text)
                return
            left = self._max - self._sent
            if len(text) <= left:
                self._sent += len(text)
                self._emit({"t": kind, "index": self._index, "data": text})
                return
            if left > 0:
                self._emit({"t": kind, "index": self._index, "data": text[:left]})
                self._sent += left
                self._dropped += len(text) - left
            else:
                self._dropped += len(text)
            self._capped = True

    def marker(self) -> None:
        with self._lock:
            if not self._capped:
                return
            dropped = self._dropped
        self._emit(
            {
                "t": "stdout",
                "index": self._index,
                "data": f"\n\u2026[truncated: {dropped} chars omitted]",
            }
        )


def _read_chunk(stream, size: int = 65536) -> bytes:
    """One chunk from a child pipe, without waiting for the buffer to fill.

    ``BufferedReader.read(n)`` blocks until it has ``n`` bytes or EOF, which
    would defeat streaming, so ``read1`` (one raw read) is preferred; an
    unbuffered ``FileIO`` falls back to ``os.read`` on its fd.
    """
    reader = getattr(stream, "read1", None)
    if reader is not None:
        return reader(size)
    return os.read(stream.fileno(), size)


def _pump_stream(
    stream,
    kind: str,
    sink: "_FrameSink | None",
    redactor,
    raw: list[str],
    proc: subprocess.Popen,
    errors: list[BaseException],
) -> None:
    """Read one child pipe, mask incrementally and emit frames (wave 15).

    Reads in chunks through an incremental UTF-8 decoder (so a multi-byte
    character split across reads is never cut), appends the decoded text to
    ``raw`` (the caller re-caps/re-redacts it for the result) and, when a
    ``sink`` is present, emits the already-masked fragment through it. A
    frame-writer failure (the client went away) is recorded and the child killed
    from here, so the other reader unblocks; the caller re-raises it.
    """
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    try:
        while True:
            try:
                chunk = _read_chunk(stream)
            except Exception:
                break
            if not chunk:
                break
            try:
                text = decoder.decode(chunk)
            except Exception:
                break
            if not text:
                continue
            raw.append(text)
            if sink is None:
                continue
            try:
                sink.push(kind, redactor.feed(text))
            except Exception as exc:  # the client vanished mid-stream
                errors.append(exc)
                _kill_process_tree(proc)
                break
    finally:
        try:
            stream.close()
        except Exception:
            pass


class _FrameRelay:
    """Relays the run-all driver's NDJSON frames to ``emit`` (wave 15).

    A line from the driver's stdout that parses as a JSON object is relayed
    verbatim (``cell-start``/``stdout``/``stderr``/``cell-end``/…); a non-JSON
    line — a cell writing straight to the driver's fd — becomes a ``stderr``
    frame carrying the current cell's index (or ``None``), matching today's
    "not captured" behaviour, and is never merged into the final result. The
    driver's own stderr is relayed as ``stderr`` frames with ``index=None``.
    Emits are serialized so the two reader threads never interleave a frame.
    """

    def __init__(self, emit: Callable[[dict], None] | None) -> None:
        self._emit = emit
        self._lock = threading.Lock()
        self._index: int | None = None

    def stdout_line(self, line: str) -> None:
        try:
            frame = json.loads(line)
        except ValueError:
            frame = None
        if not isinstance(frame, dict):
            self._send({"t": "stderr", "index": self._index, "data": line + "\n"})
            return
        kind = frame.get("t")
        if kind == "cell-start":
            self._index = frame.get("index")
        elif kind == "cell-end":
            self._index = None
        self._send(frame)

    def stderr_line(self, line: str) -> None:
        self._send({"t": "stderr", "index": None, "data": line + "\n"})

    def _send(self, frame: dict) -> None:
        if self._emit is None:
            return
        with self._lock:
            self._emit(frame)


def _pump_frames(
    stream, relay: _FrameRelay, kind: str, proc: subprocess.Popen, errors: list[BaseException]
) -> None:
    """Read one driver pipe line by line and relay each line (wave 15).

    Frames are one JSON object per line, so lines are decoded incrementally and
    split on ``\\n``; a trailing partial line is flushed at EOF. A relay/writer
    failure is recorded and the driver killed, so the other reader unblocks.
    """
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    buf = ""

    def relay_line(line: str) -> None:
        try:
            if kind == "stdout":
                relay.stdout_line(line)
            else:
                relay.stderr_line(line)
        except Exception as exc:  # the client vanished mid-stream
            errors.append(exc)
            _kill_process_tree(proc)

    try:
        while True:
            try:
                chunk = _read_chunk(stream)
            except Exception:
                break
            if not chunk:
                break
            try:
                buf += decoder.decode(chunk)
            except Exception:
                break
            while "\n" in buf:
                line, buf = buf.split("\n", 1)
                relay_line(line)
                if errors:
                    return
        tail = buf.strip("\n")
        if tail and not errors:
            relay_line(tail)
    finally:
        try:
            stream.close()
        except Exception:
            pass


class RunHandle:
    """A cancellable in-flight execution, shared between the host and the kernel.

    The host creates one per ``/run``/``/run-all`` request and keys it by the
    catalog ``itemId``; the kernel binds its child process, so ``POST /cancel``
    can kill the process group from another request thread. Thread-safe by
    construction: the HTTP server is threaded, so ``cancel`` runs concurrently
    with the ``attach`` that happens a moment after ``Popen`` returns.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._proc: subprocess.Popen | None = None
        self._pid: int | None = None
        self._cancelled = False
        self._finished = False

    @property
    def cancelled(self) -> bool:
        with self._lock:
            return self._cancelled

    @property
    def pid(self) -> int | None:
        """The child's pid once attached, or ``None`` before ``Popen`` returned.

        Kept after ``finish`` so a caller can still check whether the process is
        gone (the stop-leak test does exactly that).
        """
        with self._lock:
            return self._pid

    def attach(self, proc: subprocess.Popen) -> None:
        """Bind the child process; kill it at once if a cancel already landed.

        A ``/cancel`` that arrived between ``Popen`` and this call saw no process
        to kill, so the flag has to be honoured here or the cell would run on.
        """
        with self._lock:
            self._proc = proc
            self._pid = proc.pid
            cancelled = self._cancelled
        if cancelled:
            _kill_process_tree(proc)

    def finish(self) -> None:
        """Mark the execution done so a later ``cancel`` reports nothing to kill."""
        with self._lock:
            self._proc = None
            self._finished = True

    def cancel(self) -> bool:
        """Mark cancelled and kill the child's process group; False if it is gone.

        Idempotent: a run that finished, or that a previous ``cancel`` already
        stopped, reports nothing new to kill (so ``/cancel`` answers ``0``).
        """
        with self._lock:
            if self._finished or self._cancelled:
                return False
            self._cancelled = True
            proc = self._proc
        if proc is not None:
            _kill_process_tree(proc)
        return True


class ActiveRuns:
    """Thread-safe registry of in-flight executions keyed by an opaque id.

    One key (the catalog ``itemId``) maps to the runs currently executing for it,
    so a ``/run`` and any number of ``/run-all`` requests may overlap. ``cancel``
    kills them all and reports how many were still live, which makes it
    idempotent: a key with nothing running cancels zero.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._runs: dict[str, set[RunHandle]] = {}

    def register(self, key: str, run: RunHandle) -> RunHandle:
        with self._lock:
            self._runs.setdefault(str(key), set()).add(run)
        return run

    def release(self, key: str, run: RunHandle) -> None:
        with self._lock:
            runs = self._runs.get(str(key))
            if runs is None:
                return
            runs.discard(run)
            if not runs:
                self._runs.pop(str(key), None)

    def handles(self, key: str) -> list[RunHandle]:
        """Snapshot of the runs currently registered for ``key``."""
        with self._lock:
            return list(self._runs.get(str(key), ()))

    def active(self, key: str) -> int:
        """How many runs are currently registered for ``key``.

        Wave 10 run-guard: the host refuses a cell-structure mutation while this
        is non-zero, because insert/delete/move shift cell indices under a run
        that is about to persist its output back into the copy — the write would
        land in the wrong cell (``tests/test_notebook_persist.py``).
        """
        with self._lock:
            return len(self._runs.get(str(key), ()))

    def cancel(self, key: str) -> int:
        """Kill every live run for ``key``; how many were still in flight."""
        with self._lock:
            runs = list(self._runs.get(str(key), ()))
        return sum(1 for run in runs if run.cancel())

    def cancel_all(self) -> int:
        """Kill every live run of every key (used by ``LabHost.stop``)."""
        with self._lock:
            keys = list(self._runs)
        return sum(self.cancel(key) for key in keys)

    def __len__(self) -> int:
        with self._lock:
            return sum(len(runs) for runs in self._runs.values())


class Kernel:
    """A kernel bound to exactly one open copy (spec: one kernel per copy).

    Every copy owns its venv, so two Kernel objects for two copies run against
    two interpreters at the same time (A8). `execute` may be called from several
    threads; one cell is in flight per kernel and `interrupt` stops it from the
    UI thread.
    """

    def __init__(
        self,
        copy: CookbookCopy,
        *,
        env: Mapping[str, str] | None = None,
        redact_values: Sequence[str] | None = None,
        python: str | None = None,
        language: str = "python",
        default_timeout: float = 60.0,
    ) -> None:
        if language not in KERNEL_LANGUAGES:
            raise KernelError(
                f"unsupported kernel language {language!r}; "
                f"only {', '.join(KERNEL_LANGUAGES)} is offered"
            )
        self.copy = copy
        self.language = language
        self.env = dict(env or {})
        # The mask set for this kernel's output. ``None`` = today's behaviour
        # exactly (every ``env`` value); an explicit sequence is used verbatim
        # (order kept, blanks dropped) — hosts pass just the credential values so
        # a non-secret default such as the catalog gateway base URL stays
        # readable (see ``execute``).
        self.redact_values = tuple(redact_values) if redact_values is not None else None
        self.python = python
        self.default_timeout = float(default_timeout)
        self._lock = threading.Lock()
        # One cell in flight per kernel: a second `execute` while one is running
        # raises instead of starting a concurrent process (plan 010).
        self._run_lock = threading.Lock()
        self._proc: subprocess.Popen | None = None
        self._interrupted = False

    def ensure_python(self) -> tuple[Path, str]:
        """Interpreter inside the copy venv, created on first Run."""
        return ensure_venv(self.copy, python=self.python)

    @property
    def is_running(self) -> bool:
        with self._lock:
            proc = self._proc
        return proc is not None and proc.poll() is None

    def interrupt(self) -> bool:
        """Stop the cell in flight. True if one was running."""
        with self._lock:
            # Set the flag before reading the process: a cell that is between
            # `Popen` and `self._proc = proc` in `execute` sees it afterwards and
            # kills itself. An idle interrupt still reports False below.
            self._interrupted = True
            proc = self._proc
        if proc is None or proc.poll() is not None:
            return False
        _kill_process_tree(proc)
        return True

    def restart(self) -> None:
        """Stop the in-flight cell; the next `execute` starts a fresh process."""
        self.interrupt()

    def execute_stream(
        self,
        code: str,
        *,
        index: int | None = None,
        timeout: float | None = None,
        run: RunHandle | None = None,
        emit: Callable[[dict], None] | None = None,
    ) -> dict:
        """Run one cell, streaming its output as ``emit`` frames (wave 15).

        Same contract as ``execute`` — busy-guard, timeout, cancel, redaction,
        display records and result schema — plus two additions:

        * ``emit(frame)`` is called, while the cell runs, with one
          ``{"t": "stdout"|"stderr", "index": index, "data": <masked fragment>}``
          frame per read; fragments are already masked through
          ``redact_output_stream`` (line-buffered, with holdback). ``start``/
          ``end``/``display`` frames are the route's job, not the kernel's.
        * the result carries ``duration_ms`` (host-side ``time.monotonic``).

        The child runs ``python -u`` and both pipes are read incrementally with
        an incremental UTF-8 decoder (``errors="replace"``), so a multi-byte
        character split across reads is never cut; ``communicate`` is not used.
        ``emit is None`` is the non-streaming path (``execute``).

        Wave 11: the child is handed a temp ``results`` path (stdin payload
        ``{"code", "results", "secret_env"}``) and writes its ``display_data``
        records there in a ``finally``; the caller re-validates and re-caps them
        into ``result["displays"]``. A killed child writes nothing, so a
        timeout/cancel yields ``displays == []``. The temp dir is removed before
        this returns.

        Emission is capped: stdout + stderr share ``MAX_CAPTURE_CHARS``; once it
        is reached the data frames stop and exactly one ``stdout`` frame with a
        ``…[truncated: N chars omitted]`` marker is emitted (decision 6).
        """
        if not self._run_lock.acquire(blocking=False):
            raise KernelError("kernel busy: a cell is already running")
        started = time.monotonic()
        try:
            work_dir = None
            limit = self.default_timeout if timeout is None else float(timeout)
            py, install_log = self.ensure_python()
            proc_env = self._process_env()
            # The child redacts from its own environment: send the secret *names*
            # only, so no value is ever written to the temp payload. With an
            # explicit `redact_values` the names are exactly the env keys whose
            # value is in that mask set, so a non-secret default (the catalog
            # gateway base URL) stays readable in displays too.
            if self.redact_values is None:
                secret_names = sorted({str(name) for name, value in self.env.items() if value})
            else:
                redacted = set(self.redact_values)
                secret_names = sorted(
                    {str(name) for name, value in self.env.items() if value and value in redacted}
                )
            # Injected secrets never reach the notebook: redact both streams here
            # (and mask the live frames from the same set). Policy: ``None`` masks
            # *every* env value (historical behaviour); hosts pass just the
            # credential values, so a non-secret default — the catalog
            # ``defaultEnv`` gateway base URL — stays readable.
            if self.redact_values is None:
                secret_values = [
                    value for name, value in proc_env.items() if value and name in self.env
                ]
                secret_values.extend(value for value in self.env.values() if value)
            else:
                secret_values = [value for value in self.redact_values if value]
            work_dir = tempfile.mkdtemp(prefix="rox-run-")
            results_path = os.path.join(work_dir, "results.json")
            payload = json.dumps(
                {"code": code, "results": results_path, "secret_env": secret_names}
            )
            with self._lock:
                self._interrupted = False
            try:
                proc = subprocess.Popen(
                    [str(py), "-u", "-c", _RUNNER],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    cwd=str(self.copy.root),
                    env=proc_env,
                    start_new_session=(os.name != "nt"),
                )
            except OSError as exc:
                raise KernelError(f"could not start the kernel cell: {exc}") from exc
            # A `/cancel` may land before this Popen returned; the handle kills
            # the child itself in that window (see RunHandle.attach).
            if run is not None:
                run.attach(proc)
            with self._lock:
                self._proc = proc
            # An `interrupt()` that landed between `Popen` and the assignment above
            # saw no process to kill; honour its flag here (the reset above it
            # guarantees a stale idle interrupt cannot poison this cell).
            with self._lock:
                hit = self._interrupted
            if hit:
                _kill_process_tree(proc)
            try:
                proc.stdin.write(payload.encode("utf-8"))
                proc.stdin.close()
            except (OSError, ValueError):
                pass
            sink = _FrameSink(emit, index) if emit is not None else None
            out_redactor = redact_output_stream(secret_values)
            err_redactor = redact_output_stream(secret_values)
            out_chunks: list[str] = []
            err_chunks: list[str] = []
            errors: list[BaseException] = []
            readers = [
                threading.Thread(
                    target=_pump_stream,
                    args=(
                        proc.stdout,
                        "stdout",
                        sink,
                        out_redactor,
                        out_chunks,
                        proc,
                        errors,
                    ),
                    daemon=True,
                ),
                threading.Thread(
                    target=_pump_stream,
                    args=(
                        proc.stderr,
                        "stderr",
                        sink,
                        err_redactor,
                        err_chunks,
                        proc,
                        errors,
                    ),
                    daemon=True,
                ),
            ]
            for reader in readers:
                reader.start()
            timed_out = False

            def watchdog():
                nonlocal timed_out
                try:
                    proc.wait(timeout=limit)
                except subprocess.TimeoutExpired:
                    timed_out = True
                    _kill_process_tree(proc)

            watcher = threading.Thread(target=watchdog, daemon=True)
            watcher.start()
            try:
                for reader in readers:
                    reader.join()
                watcher.join(timeout=10)
                try:
                    proc.wait(timeout=10)
                except (subprocess.TimeoutExpired, OSError):
                    pass
                if sink is not None:
                    # Release each stream's held tail (masked) then the single
                    # truncation marker, in that order.
                    sink.push("stdout", out_redactor.flush())
                    sink.push("stderr", err_redactor.flush())
                    sink.marker()
                if errors:
                    raise errors[0]
            finally:
                with self._lock:
                    self._proc = None
                    interrupted = self._interrupted
                if run is not None:
                    run.finish()
                    cancelled = run.cancelled
                else:
                    cancelled = False
                interrupted = interrupted or cancelled
            # Wave 11: displays come back over the temp results file. A missing
            # file (kill, timeout, legacy payload) simply means none; either way
            # the records are re-validated, re-capped and re-redacted here.
            displays = _cap_displays(_read_displays(results_path), secret_values)
            result = {
                "ok": proc.returncode == 0 and not timed_out and not interrupted,
                "stdout": _cap_output(redact_output("".join(out_chunks), secret_values)),
                "stderr": _cap_output(redact_output("".join(err_chunks), secret_values)),
                "python": str(py),
                "returncode": proc.returncode,
                "install_log": install_log,
                "language": self.language,
                "timed_out": timed_out,
                "interrupted": interrupted,
                "cancelled": cancelled,
                "timeout": limit,
                "displays": displays,
                "duration_ms": int((time.monotonic() - started) * 1000),
            }
            if not result["ok"]:
                result["error"] = _error_text(result)
            return result
        finally:
            if work_dir is not None:
                shutil.rmtree(work_dir, ignore_errors=True)
            self._run_lock.release()

    def execute(
        self, code: str, *, timeout: float | None = None, run: RunHandle | None = None
    ) -> dict:
        """Run one cell (non-streaming); never raises for failure/timeout/interrupt.

        Wave 15: a thin wrapper over ``execute_stream`` with no frame sink. The
        result schema is exactly the pre-wave-15 one — the additive
        ``duration_ms`` the streaming path carries is dropped here, so callers of
        the synchronous path see the schema they always did.

        Calling this while a cell is already running raises ``KernelError`` rather
        than starting a second process (one cell per kernel; plan 010). ``run``
        binds this execution to a host-side ``RunHandle`` so ``POST /cancel`` can
        kill the child process group from another thread; the result then carries
        ``cancelled`` (and ``interrupted``) accordingly.
        """
        result = self.execute_stream(code, timeout=timeout, run=run, emit=None)
        result.pop("duration_ms", None)
        return result

    def execute_all_stream(
        self, jobs: Sequence[tuple[int, str]], *, timeout: float | None = None,
        run: RunHandle | None = None, emit: Callable[[dict], None] | None = None,
    ) -> dict:
        """Run every ``(index, source)`` job in ONE namespace, streaming frames.

        Wave 15 sibling of ``execute``/``execute``-all: the driver stays a single
        child process (cell 1 sees cell 0's names), but it now also writes NDJSON
        frames to its stdout, which this method relays through ``emit`` —
        ``cell-start``, ``stdout``/``stderr`` fragments (already masked by the
        driver) and a full ``cell-end`` record. A non-JSON line from the driver's
        stdout (a cell writing straight to the fd) is relayed as a ``stderr``
        frame with the current cell's ``index`` (or ``None``); the driver's own
        stderr is relayed the same way with ``index=None``. ``results.json`` is
        still written per cell and is the source of the returned ``cells`` — the
        frames are additive (decision 4).

        Returns the same dict as the module-level ``execute_all`` minus its host
        concerns (``persist``, catalog error rewriting): ``{"ok", "cells",
        "returncode", "timed_out", "cancelled", "python"}`` with exactly one cell
        record per job (input order).

        ``timeout`` is the per-cell budget (driver-side ``signal.setitimer``); the
        whole run is additionally bounded by ``timeout * max(len(jobs), 1) + 30``
        seconds, killed via a watchdog thread. ``run`` is the host's cancellable
        handle.
        """
        pending = [(int(index), str(source)) for index, source in jobs]
        py, _install_log = ensure_venv(self.copy, python=self.python)
        if not pending:
            return {
                "ok": True,
                "cells": [],
                "returncode": None,
                "timed_out": False,
                "cancelled": False,
                "python": str(py),
            }
        per_cell = self.default_timeout if timeout is None else float(timeout)
        proc_env = self._process_env()
        env_map = dict(self.env)
        # Same redaction policy as `execute`/`Kernel.execute`: `redact_values is
        # None` masks every value this copy declared; an explicit sequence is the
        # mask set verbatim (order kept, blanks dropped).
        if self.redact_values is None:
            secret_values = [
                value for name, value in proc_env.items() if value and name in env_map
            ]
            secret_values.extend(value for value in env_map.values() if value)
            secret_names = sorted({str(name) for name, value in env_map.items() if value})
        else:
            secret_values = [value for value in self.redact_values if value]
            # G4-CBK-01: the driver redacts before every temp write; it is handed
            # the env *names* only and reads the values from its own environment.
            redacted = set(self.redact_values)
            secret_names = sorted(
                {str(name) for name, value in env_map.items() if value and value in redacted}
            )

        work_dir = Path(tempfile.mkdtemp(prefix="rox-run-all-"))
        job_path = work_dir / "job.json"
        driver_path = work_dir / "driver.py"
        results_path = work_dir / "results.json"
        job_path.write_text(
            json.dumps(
                {
                    "cells": [[index, source] for index, source in pending],
                    "results": str(results_path),
                    "timeout": float(per_cell),
                    "secret_env": secret_names,
                }
            ),
            encoding="utf-8",
        )
        # Owner-only for defence in depth, even though the job holds no secret; the
        # driver unlinks it as soon as it has read it.
        os.chmod(job_path, 0o600)
        driver_path.write_text(_RUN_ALL_DRIVER, encoding="utf-8")

        limit = float(per_cell) * max(len(pending), 1) + 30.0
        timed_out = False
        try:
            try:
                proc = subprocess.Popen(
                    [str(py), str(driver_path), str(job_path)],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    cwd=str(self.copy.root),
                    env=proc_env,
                    start_new_session=True,
                )
            except OSError as exc:
                raise KernelError(f"could not start the run-all driver: {exc}") from exc
            if run is not None:
                run.attach(proc)
            errors: list[BaseException] = []
            relay = _FrameRelay(emit)
            readers = [
                threading.Thread(
                    target=_pump_frames,
                    args=(proc.stdout, relay, "stdout", proc, errors),
                    daemon=True,
                ),
                threading.Thread(
                    target=_pump_frames,
                    args=(proc.stderr, relay, "stderr", proc, errors),
                    daemon=True,
                ),
            ]
            for reader in readers:
                reader.start()

            def watchdog():
                nonlocal timed_out
                try:
                    proc.wait(timeout=limit)
                except subprocess.TimeoutExpired:
                    timed_out = True
                    _kill_process_tree(proc)

            watcher = threading.Thread(target=watchdog, daemon=True)
            watcher.start()
            try:
                for reader in readers:
                    reader.join()
                watcher.join(timeout=10)
                try:
                    proc.wait(timeout=10)
                except (subprocess.TimeoutExpired, OSError):
                    pass
                if errors:
                    raise errors[0]
            finally:
                if run is not None:
                    run.finish()
            returncode = proc.returncode
            records = _read_run_all_records(results_path, _run_all_read_limit(len(pending)))
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)
        cancelled = run.cancelled if run is not None else False

        by_index = {}
        for record in records:
            index = record.get("index")
            if isinstance(index, int) and index not in by_index:
                by_index[index] = record

        cells: list[dict] = []
        # Wave 11: one display budget for the whole run, consumed cell by cell in
        # document order (the driver applies the same 8 MiB cap on its side).
        shared = {"left": _DISPLAY_RUN_ALL_LIMIT}
        for index, source in pending:
            record = by_index.get(index)
            if record is None:
                cells.append(
                    {
                        "index": index,
                        "status": "skipped",
                        "ok": False,
                        "stdout": "",
                        "stderr": "",
                        "error": None,
                        "timed_out": False,
                        "duration_ms": 0,
                        "displays": [],
                    }
                )
                continue
            ok = bool(record.get("ok"))
            stdout = _cap_output(redact_output(str(record.get("stdout") or ""), secret_values))
            stderr = _cap_output(redact_output(str(record.get("stderr") or ""), secret_values))
            displays = _cap_displays(record.get("displays"), secret_values, shared=shared)
            cell = {
                "index": index,
                "status": "ok" if ok else "error",
                "ok": ok,
                "stdout": stdout,
                "stderr": stderr,
                "error": None,
                "timed_out": bool(record.get("timed_out")),
                "duration_ms": int(record.get("duration_ms") or 0),
                "displays": displays,
            }
            if not ok:
                cell["error"] = _run_all_error(cell, per_cell)
            cells.append(cell)

        return {
            "ok": all(cell["status"] == "ok" for cell in cells),
            "cells": cells,
            "returncode": returncode,
            "timed_out": timed_out,
            "cancelled": cancelled,
            "python": str(py),
        }

    def _process_env(self) -> dict[str, str]:
        # Plan 010: the child sees only the allowlist (plus this copy's declared
        # secrets), never the whole host environment — an undeclared host credential
        # must not be reachable, or a cell could print it into the notebook. If a real
        # cookbook needs another variable, add it to _CHILD_ENV_ALLOWLIST deliberately.
        return _subprocess_env(self.env)


class KernelManager:
    """Host-side registry holding at most one Kernel per open copy."""

    def __init__(
        self,
        *,
        env: Mapping[str, str] | None = None,
        python: str | None = None,
        default_timeout: float = 60.0,
    ) -> None:
        self._env = dict(env or {})
        self._python = python
        self._default_timeout = float(default_timeout)
        self._lock = threading.Lock()
        self._kernels: dict[Path, Kernel] = {}

    def kernel(self, copy: CookbookCopy, *, language: str = "python") -> Kernel:
        key = copy.root.resolve()
        with self._lock:
            kernel = self._kernels.get(key)
            if kernel is None:
                kernel = Kernel(
                    copy,
                    env=self._env,
                    python=self._python,
                    language=language,
                    default_timeout=self._default_timeout,
                )
                self._kernels[key] = kernel
            return kernel

    def __len__(self) -> int:
        with self._lock:
            return len(self._kernels)

    def copies(self) -> list[Path]:
        with self._lock:
            return list(self._kernels)

    def running(self) -> list[Kernel]:
        with self._lock:
            kernels = list(self._kernels.values())
        return [kernel for kernel in kernels if kernel.is_running]

    def interrupt_all(self) -> int:
        with self._lock:
            kernels = list(self._kernels.values())
        return sum(1 for kernel in kernels if kernel.interrupt())

    def shutdown(self) -> None:
        with self._lock:
            kernels = list(self._kernels.values())
            self._kernels.clear()
        for kernel in kernels:
            kernel.interrupt()


def run_concurrent(
    jobs: Sequence[tuple[Kernel, str]],
    *,
    timeout: float | None = None,
    max_workers: int | None = None,
) -> list[dict]:
    """Run `(kernel, code)` jobs on their own threads; results keep input order.

    A8: two copies run at once, each inside its own venv. One job raising must
    not abort the others, so its slot carries a failed result instead.
    """
    pending = list(jobs)
    if not pending:
        return []
    workers = max_workers or len(pending)
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="rox-kernel") as pool:
        futures = [pool.submit(kernel.execute, code, timeout=timeout) for kernel, code in pending]
        results: list[dict] = []
        for future in futures:
            try:
                results.append(future.result())
            except Exception as exc:
                results.append(_crash_result(exc))
        return results


def execute_code(
    copy: CookbookCopy,
    code: str,
    *,
    env: Mapping[str, str] | None = None,
    redact_values: Sequence[str] | None = None,
    persist: bool = True,
    python: str | None = None,
    index: int | None = None,
    timeout: float = 60.0,
    catalog=None,
    item=None,
    store: Mapping[str, str] | None = None,
    run: RunHandle | None = None,
) -> dict:
    """Run one Python cell in the copy venv (one-shot Kernel per call).

    Adds the host concerns the Kernel itself does not own: map a missing-credential
    traceback to the ROX message, then write the outputs into the copy's ipynb.
    ``index`` names the executed cell, so its outputs replace that cell's rather
    than the first cell whose source happens to match (plan 010). ``run`` is the
    host's cancellable handle for this request (see ``RunHandle``).
    ``redact_values`` is the mask set for the cell's output: ``None`` (default)
    masks every ``env`` value; hosts pass just the credential values, so a
    non-secret default — the catalog ``defaultEnv`` gateway base URL — stays
    readable (see ``Kernel.execute``).
    """
    result = Kernel(
        copy, env=env, redact_values=redact_values, python=python, default_timeout=timeout
    ).execute(code, run=run)
    err = result.get("error")
    if err and catalog is not None and item is not None:
        rewritten = rewrite_missing_secret_error(catalog, item, err, store)
        if rewritten:
            result["error"] = rewritten
    if persist:
        persist_code_output(copy.document, code, result, index=index)
    return result


def execute_stream(
    copy: CookbookCopy,
    code: str,
    *,
    env: Mapping[str, str] | None = None,
    redact_values: Sequence[str] | None = None,
    persist: bool = True,
    python: str | None = None,
    index: int | None = None,
    timeout: float = 60.0,
    catalog=None,
    item=None,
    store: Mapping[str, str] | None = None,
    run: RunHandle | None = None,
    emit: Callable[[dict], None] | None = None,
) -> dict:
    """Run one Python cell, streaming its output through ``emit`` (wave 15).

    The streaming twin of :func:`execute_code`: same host concerns
    (missing-credential rewriting, ipynb persistence, one-shot Kernel per call)
    plus ``emit`` — the sink the kernel calls *while the cell runs*, with
    ``{"t": "stdout"|"stderr", "index": index, "data": <masked fragment>}``
    frames. The route forms ``start``/``display``/``end`` itself; the kernel
    emits none of those. ``index`` names the executed cell (its frames carry it,
    and its outputs replace that cell's rather than the first whose source
    happens to match). The result is the ``execute_code`` dict plus the additive
    ``duration_ms``. ``emit=None`` is the non-streaming path. See
    ``Kernel.execute_stream`` for the read/cap/redaction contract.
    """
    result = Kernel(
        copy, env=env, redact_values=redact_values, python=python, default_timeout=timeout
    ).execute_stream(code, index=index, run=run, emit=emit)
    err = result.get("error")
    if err and catalog is not None and item is not None:
        rewritten = rewrite_missing_secret_error(catalog, item, err, store)
        if rewritten:
            result["error"] = rewritten
    if persist:
        persist_code_output(copy.document, code, result, index=index)
    return result


def execute_all_stream(
    copy: CookbookCopy,
    jobs: Sequence[tuple[int, str]],
    *,
    env: Mapping[str, str] | None = None,
    redact_values: Sequence[str] | None = None,
    python: str | None = None,
    timeout: float = 60.0,
    persist: bool = True,
    catalog=None,
    item=None,
    store: Mapping[str, str] | None = None,
    run: RunHandle | None = None,
    emit: Callable[[dict], None] | None = None,
) -> dict:
    """Run every ``(index, source)`` job in one namespace, streaming frames.

    Wave 15 mirror of :func:`execute_all`: the same host concerns (missing-
    credential rewriting, ipynb persistence, one-shot Kernel per call) plus
    ``emit`` — the live frame sink. The engine is ``Kernel.execute_all_stream``;
    this function only adds what the Kernel does not own. ``emit`` relays the
    driver's frames (``cell-start`` / ``stdout`` / ``stderr`` / ``cell-end``);
    the route adds the ``start``/``end`` frames. ``emit=None`` is the
    non-streaming path (``execute_all``).
    """
    pending = [(int(index), str(source)) for index, source in jobs]
    result = Kernel(
        copy, env=env, redact_values=redact_values, python=python, default_timeout=timeout
    ).execute_all_stream(pending, run=run, emit=emit)
    for cell, (index, source) in zip(result["cells"], pending):
        if cell["status"] == "error" and catalog is not None and item is not None:
            rewritten = rewrite_missing_secret_error(
                catalog, item, cell["stderr"] or cell["stdout"] or cell["error"], store
            )
            if rewritten:
                cell["error"] = rewritten
        if persist and cell["status"] in ("ok", "error"):
            persist_code_output(
                copy.document,
                source,
                {
                    "ok": cell["ok"],
                    "stdout": cell["stdout"],
                    "stderr": cell["stderr"],
                    "error": cell["error"],
                    "displays": cell["displays"],
                },
                index=cell["index"],
            )
    return result


def execute_all(
    copy: CookbookCopy,
    jobs: Sequence[tuple[int, str]],
    *,
    env: Mapping[str, str] | None = None,
    redact_values: Sequence[str] | None = None,
    python: str | None = None,
    timeout: float = 60.0,
    persist: bool = True,
    catalog=None,
    item=None,
    store: Mapping[str, str] | None = None,
    run: RunHandle | None = None,
) -> dict:
    """Run every ``(index, source)`` job in document order in ONE namespace.

    Plan 016: unlike ``execute_code`` (a fresh process per cell), the jobs share
    one child process and one namespace, so a later cell can use the names an
    earlier one defined. Execution stops at the first failure; the remaining
    jobs are reported ``skipped``. Returns ``{"ok", "cells", "returncode",
    "timed_out", "cancelled", "python"}`` with exactly one cell record per job
    (input order), each ``{"index", "status": "ok"|"error"|"skipped", "ok",
    "stdout", "stderr", "error", "timed_out", "duration_ms", "displays"}``.
    ``ok`` is True only when every requested cell ran ok. Wave 11: ``displays``
    is the cell's re-validated/re-capped ``display_data`` list (``[]`` for a
    ``skipped`` cell), drawn from one 8 MiB budget for the whole run.

    ``timeout`` is the per-cell budget (driver-side ``signal.setitimer``, a
    no-op where unavailable); the whole run is additionally bounded by
    ``timeout * max(len(jobs), 1) + 30`` seconds, and on expiry the process
    group is killed and jobs without a record are ``skipped``. ``env`` is the
    child environment overlay (the copy's declared secrets); its values are
    redacted from every stream (in the driver, before each temp write, and again
    here), and the driver is given the secret *names* only — it reads the values
    from its own environment, so no secret value reaches the temp job file.
    ``redact_values`` narrows *which* values are masked: ``None`` (default)
    masks every ``env`` value, while hosts pass just the credential values, so a
    non-secret default — the catalog ``defaultEnv`` gateway base URL — stays
    readable in the streams, the displays and the temp records. The
    job file is written ``0600`` and unlinked by the driver once read. Failures
    are mapped to the ROX missing-credential message when ``catalog``/``item``
    are given. With ``persist`` the executed cells' outputs are written into the
    copy's ipynb (``skipped`` cells keep whatever they had). ``run`` is the
    host's cancellable handle for this request (see ``RunHandle``); after a
    ``/cancel`` the records already in ``results.json`` are kept and the missing
    cells stay ``skipped``.

    Capture caveat: the driver captures a cell by swapping ``sys.stdout``/
    ``sys.stderr`` for ``io.StringIO``, so a cell that writes through
    ``os.write(1, ...)`` or the original ``sys.__stdout__``/``sys.__stderr__``
    bypasses per-cell capture — those bytes reach the driver's own stdout, which
    is discarded (on the streaming path they become ``stderr`` frames for the
    current cell, never part of the result). Use ``print`` (or ``sys.stdout``)
    for captured output.

    Wave 15: a thin wrapper over :func:`execute_all_stream` with ``emit=None``,
    so the synchronous path is byte-for-byte what it always was.
    """
    return execute_all_stream(
        copy,
        jobs,
        env=env,
        redact_values=redact_values,
        python=python,
        timeout=timeout,
        persist=persist,
        catalog=catalog,
        item=item,
        store=store,
        run=run,
        emit=None,
    )


def _read_run_all_records(path: Path, limit: int) -> list[dict]:
    """The per-cell records the driver wrote so far; ``[]`` when it wrote none.

    G4-F2: the same size gate as ``_read_displays`` — ``limit`` is what our own
    driver could legitimately have written for this run (``_run_all_read_limit``),
    so anything bigger is not read at all.
    """
    data = _read_temp_json(path, limit)
    records = data.get("cells") if isinstance(data, dict) else None
    if not isinstance(records, list):
        return []
    return [record for record in records if isinstance(record, dict)]


def _run_all_error(cell: Mapping, timeout: float) -> str:
    if cell.get("timed_out"):
        return (
            f"Kernel cell timed out after {float(timeout):g}s and was stopped. "
            "Raise the cell timeout or make the cell shorter."
        )
    return cell.get("stderr") or cell.get("stdout") or "Kernel cell failed."


def _kill_process_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            proc.kill()
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except OSError:
        try:
            proc.kill()
        except OSError:
            pass
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        pass


def _error_text(result: Mapping) -> str:
    if result.get("timed_out"):
        return (
            f"Kernel cell timed out after {result['timeout']}s and was stopped. "
            "Raise the cell timeout or make the cell shorter."
        )
    if result.get("interrupted"):
        return "Kernel cell was interrupted."
    return (
        result.get("stderr")
        or result.get("stdout")
        or f"Kernel exited with code {result.get('returncode')}"
    )


def _crash_result(exc: BaseException) -> dict:
    return {
        "ok": False,
        "stdout": "",
        "stderr": "",
        "python": None,
        "returncode": None,
        "install_log": "",
        "language": None,
        "timed_out": False,
        "interrupted": False,
        "timeout": None,
        "displays": [],
        "error": f"{type(exc).__name__}: {exc}",
    }
