from __future__ import annotations

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
from .secrets import redact_output, rewrite_missing_secret_error


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


# Cell runner: one isolated `python -c` per cell. T0 uses this instead of a
# long-lived ZMQ kernel so the spike is testable without jupyter_client. The
# Electron host can swap the transport for ipykernel over 127.0.0.1 + token;
# the copy/venv/env contract below stays the same either way.
_RUNNER = (
    "import json,sys,traceback\n"
    "code=json.loads(sys.stdin.read())\n"
    "try:\n"
    "    ns={}\n"
    "    exec(compile(code,'<cell>','exec'), ns, ns)\n"
    "except Exception:\n"
    "    traceback.print_exc()\n"
    "    sys.exit(1)\n"
)


# Plan 016 "Run all": one child process runs every code cell of a copy, in
# document order, inside a single namespace, so cell 2 sees the names cell 1
# defined (the vendor cookbooks assume this Jupyter behaviour; the one-shot
# `_RUNNER` above cannot). The caller writes a job JSON plus this script into a
# temp dir and reconciles the per-cell records the driver appends after each
# cell — a kill mid-run (overall timeout, interrupt) still yields the records of
# the cells that finished. Protocol: argv[1] is the job JSON path, holding
# ``{"cells": [[index, source], ...], "results": <path>, "timeout": <per-cell>}``.
_RUN_ALL_DRIVER = r'''
import io, json, os, signal, sys, time, traceback


def _redact(text, secrets):
    # Host-injected secret values must never reach the temp results file: the
    # caller can be killed (cancel/overall timeout) before it gets to redact the
    # records itself, so masking happens here, before every write. Longest-first
    # so a secret that starts with another stays masked whole (secrets policy).
    for value in sorted({v for v in secrets if v}, key=lambda s: (-len(s), s)):
        text = text.replace(value, "***")
    return text


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
    secrets = [os.environ.get(name) for name in (job.get("secret_env") or [])]
    timer = hasattr(signal, "setitimer")

    class CellTimeout(Exception):
        pass

    if timer:
        def _on_alarm(signum, frame):
            raise CellTimeout()

        signal.signal(signal.SIGALRM, _on_alarm)

    records, ns = [], {}
    for index, source in job["cells"]:
        start = time.monotonic()
        out, err = io.StringIO(), io.StringIO()
        rec = {"index": index, "ok": False, "stdout": "", "stderr": "",
               "timed_out": False, "duration_ms": 0}
        old = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = out, err
        if timer:
            signal.setitimer(signal.ITIMER_REAL, per_cell)
        try:
            exec(compile(source, "<cell %d>" % index, "exec"), ns, ns)
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
        rec["stdout"], rec["stderr"] = _redact(out.getvalue(), secrets), _redact(
            err.getvalue(), secrets
        )
        rec["duration_ms"] = int((time.monotonic() - start) * 1000)
        records.append(rec)
        _write(results_path, {"cells": records})
        if not rec["ok"]:
            break
    _write(results_path, {"cells": records})
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
'''


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

    def execute(
        self, code: str, *, timeout: float | None = None, run: RunHandle | None = None
    ) -> dict:
        """Run one cell; never raises for cell failure, timeout or interrupt.

        Calling this while a cell is already running raises ``KernelError`` rather
        than starting a second process (one cell per kernel; plan 010). ``run``
        binds this execution to a host-side ``RunHandle`` so ``POST /cancel`` can
        kill the child process group from another thread; the result then carries
        ``cancelled`` (and ``interrupted``) accordingly.
        """
        if not self._run_lock.acquire(blocking=False):
            raise KernelError("kernel busy: a cell is already running")
        try:
            limit = self.default_timeout if timeout is None else float(timeout)
            py, install_log = self.ensure_python()
            proc_env = self._process_env()
            with self._lock:
                self._interrupted = False
            proc = subprocess.Popen(
                [str(py), "-c", _RUNNER],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                errors="replace",
                cwd=str(self.copy.root),
                env=proc_env,
                start_new_session=(os.name != "nt"),
            )
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
            timed_out = False
            try:
                out, err = proc.communicate(input=json.dumps(code), timeout=limit)
            except subprocess.TimeoutExpired:
                timed_out = True
                _kill_process_tree(proc)
                out, err = proc.communicate()
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
            # Injected secrets never reach the notebook: redact both streams here and
            # build `error` from the redacted text so a traceback cannot leak a key.
            # Redact the store values as they land in this cell's final env (plan 010).
            secret_values = [
                value for name, value in proc_env.items() if value and name in self.env
            ]
            secret_values.extend(value for value in self.env.values() if value)
            result = {
                "ok": proc.returncode == 0 and not timed_out and not interrupted,
                "stdout": _cap_output(redact_output(out or "", secret_values)),
                "stderr": _cap_output(redact_output(err or "", secret_values)),
                "python": str(py),
                "returncode": proc.returncode,
                "install_log": install_log,
                "language": self.language,
                "timed_out": timed_out,
                "interrupted": interrupted,
                "cancelled": cancelled,
                "timeout": limit,
            }
            if not result["ok"]:
                result["error"] = _error_text(result)
            return result
        finally:
            self._run_lock.release()

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
    """
    result = Kernel(copy, env=env, python=python, default_timeout=timeout).execute(
        code, run=run
    )
    err = result.get("error")
    if err and catalog is not None and item is not None:
        rewritten = rewrite_missing_secret_error(catalog, item, err, store)
        if rewritten:
            result["error"] = rewritten
    if persist:
        persist_code_output(copy.document, code, result, index=index)
    return result


def execute_all(
    copy: CookbookCopy,
    jobs: Sequence[tuple[int, str]],
    *,
    env: Mapping[str, str] | None = None,
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
    "stdout", "stderr", "error", "timed_out", "duration_ms"}``. ``ok`` is True
    only when every requested cell ran ok.

    ``timeout`` is the per-cell budget (driver-side ``signal.setitimer``, a
    no-op where unavailable); the whole run is additionally bounded by
    ``timeout * max(len(jobs), 1) + 30`` seconds, and on expiry the process
    group is killed and jobs without a record are ``skipped``. ``env`` is the
    child environment overlay (the copy's declared secrets); its values are
    redacted from every stream (in the driver, before each temp write, and again
    here), and the driver is given the secret *names* only — it reads the values
    from its own environment, so no secret value reaches the temp job file. The
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
    is discarded. Use ``print`` (or ``sys.stdout``) for captured output.
    """
    pending = [(int(index), str(source)) for index, source in jobs]
    py, _install_log = ensure_venv(copy, python=python)
    if not pending:
        return {
            "ok": True,
            "cells": [],
            "returncode": None,
            "timed_out": False,
            "cancelled": False,
            "python": str(py),
        }
    proc_env = _subprocess_env(env)
    env_map = dict(env or {})
    # Same redaction policy as `Kernel.execute`: every value this copy declared.
    secret_values = [value for name, value in proc_env.items() if value and name in env_map]
    secret_values.extend(value for value in env_map.values() if value)
    # G4-CBK-01: the driver redacts before every temp write, so a kill mid-run
    # cannot leave a raw secret on disk. It is handed the env *names* only and
    # reads the values from its own environment (they are already in `proc_env`),
    # so no secret value ever reaches the job file either.
    secret_names = sorted({str(name) for name, value in env_map.items() if value})

    work_dir = Path(tempfile.mkdtemp(prefix="rox-run-all-"))
    job_path = work_dir / "job.json"
    driver_path = work_dir / "driver.py"
    results_path = work_dir / "results.json"
    job_path.write_text(
        json.dumps(
            {
                "cells": [[index, source] for index, source in pending],
                "results": str(results_path),
                "timeout": float(timeout),
                "secret_env": secret_names,
            }
        ),
        encoding="utf-8",
    )
    # Owner-only for defence in depth, even though the job holds no secret; the
    # driver unlinks it as soon as it has read it.
    os.chmod(job_path, 0o600)
    driver_path.write_text(_RUN_ALL_DRIVER, encoding="utf-8")

    limit = float(timeout) * max(len(pending), 1) + 30.0
    timed_out = False
    try:
        try:
            proc = subprocess.Popen(
                [str(py), str(driver_path), str(job_path)],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                errors="replace",
                cwd=str(copy.root),
                env=proc_env,
                start_new_session=True,
            )
        except OSError as exc:
            raise KernelError(f"could not start the run-all driver: {exc}") from exc
        if run is not None:
            run.attach(proc)
        try:
            proc.communicate(timeout=limit)
        except subprocess.TimeoutExpired:
            timed_out = True
            _kill_process_tree(proc)
            proc.communicate()
        returncode = proc.returncode
        records = _read_run_all_records(results_path)
    finally:
        if run is not None:
            run.finish()
        shutil.rmtree(work_dir, ignore_errors=True)
    cancelled = run.cancelled if run is not None else False

    by_index = {}
    for record in records:
        index = record.get("index")
        if isinstance(index, int) and index not in by_index:
            by_index[index] = record

    cells: list[dict] = []
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
                }
            )
            continue
        ok = bool(record.get("ok"))
        stdout = _cap_output(redact_output(str(record.get("stdout") or ""), secret_values))
        stderr = _cap_output(redact_output(str(record.get("stderr") or ""), secret_values))
        cell = {
            "index": index,
            "status": "ok" if ok else "error",
            "ok": ok,
            "stdout": stdout,
            "stderr": stderr,
            "error": None,
            "timed_out": bool(record.get("timed_out")),
            "duration_ms": int(record.get("duration_ms") or 0),
        }
        if not ok:
            error = _run_all_error(cell, timeout)
            if catalog is not None and item is not None:
                rewritten = rewrite_missing_secret_error(
                    catalog, item, stderr or stdout or error, store
                )
                if rewritten:
                    error = rewritten
            cell["error"] = error
        if persist:
            persist_code_output(
                copy.document,
                source,
                {"ok": ok, "stdout": stdout, "stderr": stderr, "error": cell["error"]},
                index=index,
            )
        cells.append(cell)

    return {
        "ok": all(cell["status"] == "ok" for cell in cells),
        "cells": cells,
        "returncode": returncode,
        "timed_out": timed_out,
        "cancelled": cancelled,
        "python": str(py),
    }


def _read_run_all_records(path: Path) -> list[dict]:
    """The per-cell records the driver wrote so far; ``[]`` when it wrote none."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
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
        "error": f"{type(exc).__name__}: {exc}",
    }
