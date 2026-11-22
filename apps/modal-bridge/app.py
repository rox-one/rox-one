"""rox-sandbox-bridge — HTTP-мост к песочницам Modal в воркспейсе арендатора.

Мост развёрнут один раз в воркспейсе Rox. Песочницы он создаёт по токену
самого арендатора: токен приходит в каждом запросе заголовком
``Authorization: Bearer <token_id>:<token_secret>``, живёт только внутри
обработчика и не попадает ни в лог, ни в ``modal.Dict``, ни в ответ.

  POST   /v1/sandboxes                    создать песочницу
  GET    /v1/sandboxes/{id}               состояние
  POST   /v1/sandboxes/{id}/exec          выполнить команду
  GET    /v1/sandboxes/{id}/files?path=   прочитать файл
  PUT    /v1/sandboxes/{id}/files?path=   записать файл
  POST   /v1/sandboxes/{id}/stop          остановить
  DELETE /v1/sandboxes/{id}               остановить и забыть

Состояния: starting, running, stopped, failed, expired.
Любая ошибка — ``{"error": {"code": ..., "message": ...}}`` с русским текстом.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import inspect
import json
import logging
import secrets

import fastapi
import modal
from fastapi import Request, Response
from fastapi.responses import JSONResponse

app = modal.App("rox-sandbox-bridge")

# Наш собственный номер песочницы -> где она живёт в Modal. Секретов здесь нет.
sandbox_map = modal.Dict.from_name("rox-sandbox-bridge-map", create_if_missing=True)

MAX_BODY_BYTES = 1024 * 1024
MAX_STREAM_CHARS = 256 * 1024
MAX_TIMEOUT_SEC = 86400
MAX_EXEC_SEC = 600
MAX_TOKEN_PART = 512

ID_PREFIX = "sbx_"
ID_LENGTH = len(ID_PREFIX) + 24

log = logging.getLogger("rox-sandbox-bridge")
log.setLevel(logging.INFO)

ROUTE_CREATE = "POST /v1/sandboxes"
ROUTE_GET = "GET /v1/sandboxes/{id}"
ROUTE_EXEC = "POST /v1/sandboxes/{id}/exec"
ROUTE_FILES_GET = "GET /v1/sandboxes/{id}/files"
ROUTE_FILES_PUT = "PUT /v1/sandboxes/{id}/files"
ROUTE_STOP = "POST /v1/sandboxes/{id}/stop"
ROUTE_DELETE = "DELETE /v1/sandboxes/{id}"

MESSAGE_UNAUTHORIZED = "Нужен заголовок Authorization с токеном Modal вида <token_id>:<token_secret>."
MESSAGE_BEARER_MALFORMED = "Заголовок Authorization испорчен: ожидается «Bearer <token_id>:<token_secret>» из двух частей через двоеточие."
MESSAGE_NOT_FOUND = "Песочница не найдена."
MESSAGE_FILE_NOT_FOUND = "Такого файла в песочнице нет."
MESSAGE_BODY_TOO_LARGE = "Тело запроса больше 1 МиБ."
MESSAGE_BODY_NOT_JSON = "Тело запроса не разобрано как JSON-объект."
MESSAGE_MODAL_AUTH = "Modal не принял токен арендатора."
MESSAGE_MODAL_REJECTED = "Modal отклонил параметры запроса."
MESSAGE_MODAL_FAILED = "Modal не выполнил запрос; подробности не раскрываются."
MESSAGE_REATTACH = "Эта сборка Modal SDK не умеет заново подключаться к песочнице по её номеру."
MESSAGE_CLIENT_UNSUPPORTED = "Эта сборка Modal SDK не принимает токен арендатора, поэтому мост не станет создавать песочницу в чужом воркспейсе."


class BridgeError(Exception):
    """Ошибка контракта: код ответа, короткий машинный код и русский текст."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.message = message


# ---------------------------------------------------------------------------
# Токен: разбор заголовка и клиент Modal на один запрос
# ---------------------------------------------------------------------------


def parse_bearer(header: str | None) -> tuple[str, str]:
    """Разбирает ``Bearer <token_id>:<token_secret>``.

    Возвращает пару (token_id, token_secret). Сам заголовок никогда не
    попадает ни в текст ошибки, ни в лог.
    """
    if not header or not header.strip():
        raise BridgeError(401, "BEARER_MISSING", MESSAGE_UNAUTHORIZED)
    scheme, _, value = header.strip().partition(" ")
    value = value.strip()
    if scheme.lower() != "bearer" or not value:
        raise BridgeError(401, "BEARER_MALFORMED", MESSAGE_BEARER_MALFORMED)
    if any(ch.isspace() for ch in value):
        raise BridgeError(401, "BEARER_MALFORMED", MESSAGE_BEARER_MALFORMED)
    token_id, sep, token_secret = value.partition(":")
    if not sep or not token_id or not token_secret:
        raise BridgeError(401, "BEARER_MALFORMED", MESSAGE_BEARER_MALFORMED)
    if len(token_id) > MAX_TOKEN_PART or len(token_secret) > MAX_TOKEN_PART:
        raise BridgeError(401, "BEARER_MALFORMED", MESSAGE_BEARER_MALFORMED)
    return token_id, token_secret


def modal_client(token_id: str, token_secret: str):
    """Собирает клиента Modal под токен арендатора. Ничего не кэширует."""
    from_credentials = getattr(modal.Client, "from_credentials", None)
    if from_credentials is None:
        raise BridgeError(500, "CLIENT_UNSUPPORTED", MESSAGE_CLIENT_UNSUPPORTED)
    try:
        return from_credentials(token_id, token_secret)
    except TypeError:
        raise BridgeError(500, "CLIENT_UNSUPPORTED", MESSAGE_CLIENT_UNSUPPORTED) from None


def _client_of(request: Request):
    """Клиент арендатора на этот запрос; токен дальше обработчика не идёт."""
    token_id, token_secret = parse_bearer(request.headers.get("authorization"))
    return modal_client(token_id, token_secret)


# ---------------------------------------------------------------------------
# Мелкие помощники
# ---------------------------------------------------------------------------


def _log(route: str, status: int, sandbox_id: str | None = None) -> None:
    """Пишет только маршрут, код ответа и наш ``sbx_`` номер."""
    log.info("%s %s %s", route, status, sandbox_id or "-")


def _params(fn) -> list[str]:
    try:
        return list(inspect.signature(fn).parameters)
    except (TypeError, ValueError):
        return []


def _accepts_client(fn) -> bool:
    return "client" in _params(fn)


def _is_not_found(exc: BaseException) -> bool:
    return isinstance(exc, FileNotFoundError) or type(exc).__name__ in (
        "NotFoundError",
        "FileNotFoundError",
        "SandboxFilesystemNotFoundError",
    )


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _iso(moment: dt.datetime) -> str:
    return moment.astimezone(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_iso(value: str) -> dt.datetime | None:
    try:
        return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def new_sandbox_id() -> str:
    return ID_PREFIX + secrets.token_hex(12)


def _valid_id(sandbox_id: str) -> bool:
    if len(sandbox_id) != ID_LENGTH or not sandbox_id.startswith(ID_PREFIX):
        return False
    return all(ch in "0123456789abcdef" for ch in sandbox_id[len(ID_PREFIX) :])


def _entry(sandbox_id: str) -> dict:
    if not _valid_id(sandbox_id):
        raise BridgeError(404, "SANDBOX_NOT_FOUND", MESSAGE_NOT_FOUND)
    entry = sandbox_map.get(sandbox_id)
    if not entry:
        raise BridgeError(404, "SANDBOX_NOT_FOUND", MESSAGE_NOT_FOUND)
    return entry


def _save(entry: dict) -> None:
    sandbox_map[entry["id"]] = entry


def _mark(entry: dict, state: str) -> dict:
    if entry.get("state") == state:
        return entry
    entry["state"] = state
    if state == "running" and not entry.get("started_at"):
        entry["started_at"] = _iso(_now())
    _save(entry)
    return entry


def _deadline(entry: dict) -> dt.datetime | None:
    created = _parse_iso(entry.get("created_at"))
    if created is None or not entry.get("timeout_sec"):
        return None
    return created + dt.timedelta(seconds=int(entry["timeout_sec"]))


async def _raw_body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared:
        try:
            if int(declared) > MAX_BODY_BYTES:
                raise BridgeError(413, "BODY_TOO_LARGE", MESSAGE_BODY_TOO_LARGE)
        except ValueError:
            raise BridgeError(400, "BAD_CONTENT_LENGTH", "Заголовок Content-Length испорчен.") from None
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        raise BridgeError(413, "BODY_TOO_LARGE", MESSAGE_BODY_TOO_LARGE)
    return raw


async def _json_body(request: Request) -> dict:
    raw = await _raw_body(request)
    if not raw:
        return {}
    try:
        body = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise BridgeError(400, "BAD_JSON", MESSAGE_BODY_NOT_JSON) from None
    if not isinstance(body, dict):
        raise BridgeError(400, "BAD_JSON", MESSAGE_BODY_NOT_JSON)
    return body


def _number(value, *, field: str, minimum: float = 0.0, integer: bool = False):
    if isinstance(value, bool) or value is None:
        raise BridgeError(400, "BAD_PARAMS", f"Поле {field} должно быть числом больше {minimum}.")
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise BridgeError(400, "BAD_PARAMS", f"Поле {field} должно быть числом больше {minimum}.") from None
    if number <= minimum:
        raise BridgeError(400, "BAD_PARAMS", f"Поле {field} должно быть числом больше {minimum}.")
    return int(number) if integer else number


def _classify(exc: BaseException) -> BridgeError:
    """Переводит исключение Modal в ошибку контракта без текста исключения."""
    name = type(exc).__name__
    if name in ("AuthError", "UnauthenticatedError", "PermissionDeniedError", "AuthorizationError"):
        return BridgeError(401, "MODAL_AUTH_FAILED", MESSAGE_MODAL_AUTH)
    if _is_not_found(exc):
        return BridgeError(404, "NOT_FOUND", MESSAGE_NOT_FOUND)
    if name in ("InvalidError", "ValueError", "TypeError", "ResourceExhaustedError"):
        return BridgeError(400, "MODAL_REJECTED", MESSAGE_MODAL_REJECTED)
    if name in ("SandboxTimeoutError", "TimeoutError", "ExecTimeoutError"):
        return BridgeError(504, "TIMEOUT", "Запрос к Modal не уложился в отведённое время.")
    if name in ("FunctionTimeoutError",):
        return BridgeError(504, "TIMEOUT", "Запрос к Modal не уложился в отведённое время.")
    return BridgeError(502, "MODAL_FAILED", MESSAGE_MODAL_FAILED)


@contextlib.contextmanager
def _modal_errors(route: str, sandbox_id: str | None = None):
    try:
        yield
    except BridgeError as exc:
        _log(route, exc.status, sandbox_id)
        raise
    except Exception as exc:  # noqa: BLE001 — наружу уходит только наш текст
        converted = _classify(exc)
        _log(route, converted.status, sandbox_id)
        raise converted from None


# ---------------------------------------------------------------------------
# Песочница: приложение, создание, повторное подключение, состояние
# ---------------------------------------------------------------------------


def _tenant_app(client):
    lookup = modal.App.lookup
    if not _accepts_client(lookup):
        raise BridgeError(500, "CLIENT_UNSUPPORTED", MESSAGE_CLIENT_UNSUPPORTED)
    return lookup("rox-sandbox-bridge", create_if_missing=True, client=client)


def _tenant_image(image: str | None):
    if not image:
        return modal.Image.debian_slim()
    return modal.Image.from_registry(str(image))


def _create_sandbox(client, *, cpu: float, memory_mb: int, gpu: str | None, image: str | None,
                    timeout_sec: int, env: dict, tags: dict, rox_id: str):
    create = modal.Sandbox.create
    if not _accepts_client(create):
        raise BridgeError(500, "CLIENT_UNSUPPORTED", MESSAGE_CLIENT_UNSUPPORTED)
    kwargs = {
        "app": _tenant_app(client),
        "image": _tenant_image(image),
        "timeout": timeout_sec,
        "idle_timeout": None,
        "cpu": cpu,
        "memory": memory_mb,
        "env": env,
        "block_network": False,
        "tags": {**tags, "rox_id": rox_id},
        "client": client,
    }
    if gpu:
        kwargs["gpu"] = str(gpu)
    return create(**kwargs)


def _sandbox_handle(entry: dict, client):
    """Возвращает объект песочницы в воркспейсе арендатора."""
    modal_id = entry.get("modal_id")
    if not modal_id:
        raise BridgeError(404, "SANDBOX_NOT_FOUND", MESSAGE_NOT_FOUND)
    from_id = getattr(modal.Sandbox, "from_id", None)
    if from_id is not None and _accepts_client(from_id):
        return from_id(modal_id, client=client)
    return _sandbox_by_tag(entry, client)


def _sandbox_by_tag(entry: dict, client):
    lister = getattr(modal.Sandbox, "list", None)
    if lister is None or not _accepts_client(lister):
        raise BridgeError(503, "REATTACH_UNAVAILABLE", MESSAGE_REATTACH)
    app_id = getattr(_tenant_app(client), "app_id", None)
    for sandbox in lister(app_id=app_id, tags={"rox_id": entry["id"]}, client=client):
        if getattr(sandbox, "object_id", None) == entry.get("modal_id"):
            return sandbox
    raise BridgeError(404, "SANDBOX_NOT_FOUND", MESSAGE_NOT_FOUND)


def _polled_state(handle) -> str | None:
    """Снимает живое состояние через poll(): None — идёт, 0 — кончилась, иначе сбой."""
    if handle is None:
        return None
    poll = getattr(handle, "poll", None)
    if poll is None:
        return None
    code = poll()
    if code is None:
        return "running"
    return "stopped" if int(code) == 0 else "failed"


def _describe(entry: dict, client) -> dict:
    state = str(entry.get("state") or "starting")
    if state in ("stopped", "failed", "expired"):
        return entry
    limit = _deadline(entry)
    if limit is not None and _now() >= limit:
        return _mark(entry, "expired")
    try:
        handle = _sandbox_handle(entry, client)
    except BridgeError as exc:
        if exc.status == 404:
            return _mark(entry, "failed")
        raise
    live = _polled_state(handle)
    if live is not None and live != state:
        entry = _mark(entry, live)
    return entry


def _public(entry: dict) -> dict:
    payload = {
        "id": entry["id"],
        "state": entry.get("state") or "starting",
        "created_at": entry.get("created_at"),
    }
    if entry.get("started_at"):
        payload["started_at"] = entry["started_at"]
    return payload


def _read_stream(stream) -> str:
    if stream is None:
        return ""
    try:
        raw = stream.read()
    except Exception:  # noqa: BLE001 — поток уже закрыт, отдаём пустую строку
        return ""
    if isinstance(raw, bytes):
        text = raw.decode("utf-8", "replace")
    else:
        text = str(raw or "")
    if len(text) > MAX_STREAM_CHARS:
        text = text[:MAX_STREAM_CHARS]
    return text


def _fs_write_bytes(filesystem, path: str, data: bytes) -> None:
    params = _params(filesystem.write_bytes)
    if params and params[0] == "path":
        filesystem.write_bytes(path, data)
    else:
        filesystem.write_bytes(data, path)


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

web_image = modal.Image.debian_slim().pip_install("fastapi[standard]==0.115.*")


@app.function(image=web_image, timeout=900)
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def bridge():
    api = fastapi.FastAPI(title="rox-sandbox-bridge")

    @api.exception_handler(BridgeError)
    async def _bridge_error(_request: Request, exc: BridgeError):
        return JSONResponse(
            status_code=exc.status,
            content={"error": {"code": exc.code, "message": exc.message}},
        )

    @api.exception_handler(Exception)
    async def _unexpected(_request: Request, exc: Exception):
        converted = _classify(exc)
        return JSONResponse(
            status_code=converted.status,
            content={"error": {"code": converted.code, "message": converted.message}},
        )

    @api.exception_handler(fastapi.exceptions.RequestValidationError)
    async def _bad_request(_request: Request, exc: Exception):
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "BAD_PARAMS", "message": "Параметры запроса не разобраны."}},
        )

    @api.get("/healthz")
    async def healthz():
        return {"ok": True}

    @api.post("/v1/sandboxes")
    async def create_sandbox(request: Request):
        client = _client_of(request)
        body = await _json_body(request)
        cpu = _number(body.get("cpu"), field="cpu")
        memory_mb = _number(body.get("memory_mb"), field="memory_mb", integer=True)
        timeout_sec = _number(body.get("timeout_sec", 300), field="timeout_sec", integer=True)
        if timeout_sec > MAX_TIMEOUT_SEC:
            raise BridgeError(400, "BAD_PARAMS", "timeout_sec не может быть больше 86400 секунд.")
        gpu = body.get("gpu")
        if gpu is not None and not isinstance(gpu, str):
            raise BridgeError(400, "BAD_PARAMS", "Поле gpu должно быть строкой вроде «T4» или «H100:2».")
        image = body.get("image")
        if image is not None and not isinstance(image, str):
            raise BridgeError(400, "BAD_PARAMS", "Поле image должно быть строкой с именем образа.")
        env = body.get("env") or {}
        if not isinstance(env, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in env.items()):
            raise BridgeError(400, "BAD_PARAMS", "Поле env должно быть словарём строковых значений.")
        tags = body.get("tags") or {}
        if not isinstance(tags, dict):
            raise BridgeError(400, "BAD_PARAMS", "Поле tags должно быть словарём.")
        tags = {str(k): str(v) for k, v in tags.items() if str(k) != "rox_id"}

        sandbox_id = new_sandbox_id()
        with _modal_errors(ROUTE_CREATE, sandbox_id):
            sandbox = _create_sandbox(
                client,
                cpu=cpu,
                memory_mb=memory_mb,
                gpu=gpu,
                image=image,
                timeout_sec=timeout_sec,
                env=env,
                tags=tags,
                rox_id=sandbox_id,
            )
        modal_id = getattr(sandbox, "object_id", None)
        if not modal_id:
            raise BridgeError(502, "MODAL_FAILED", "Modal создал песочницу, но не вернул её номер.")
        entry = {
            "id": sandbox_id,
            "modal_id": modal_id,
            "created_at": _iso(_now()),
            "timeout_sec": timeout_sec,
            "state": "starting",
        }
        _save(entry)
        _log(ROUTE_CREATE, 200, sandbox_id)
        return _public(entry)

    @api.get("/v1/sandboxes/{sandbox_id}")
    async def get_sandbox(sandbox_id: str, request: Request):
        client = _client_of(request)
        entry = _entry(sandbox_id)
        with _modal_errors(ROUTE_GET, sandbox_id):
            entry = _describe(entry, client)
        _log(ROUTE_GET, 200, sandbox_id)
        return _public(entry)

    @api.post("/v1/sandboxes/{sandbox_id}/exec")
    async def exec_in_sandbox(sandbox_id: str, request: Request):
        client = _client_of(request)
        entry = _entry(sandbox_id)
        body = await _json_body(request)
        command = body.get("command")
        if not isinstance(command, str) or not command.strip():
            raise BridgeError(400, "BAD_PARAMS", "Поле command должно быть непустой строкой с командой оболочки.")
        limit = _deadline(entry)
        remaining = int((limit - _now()).total_seconds()) if limit else MAX_TIMEOUT_SEC
        if remaining <= 0:
            _mark(entry, "expired")
            raise BridgeError(410, "SANDBOX_EXPIRED", "Срок жизни песочницы истёк.")
        timeout_sec = _number(body.get("timeout_sec", min(120, remaining)), field="timeout_sec", integer=True)
        timeout_sec = max(1, min(timeout_sec, remaining, MAX_EXEC_SEC))
        with _modal_errors(ROUTE_EXEC, sandbox_id):
            sandbox = _sandbox_handle(entry, client)
            process = sandbox.exec("bash", "-lc", command, timeout=timeout_sec)
            exit_code = int(process.wait())
            stdout = _read_stream(process.stdout)
            stderr = _read_stream(process.stderr)
        if entry.get("state") == "starting":
            _mark(entry, "running")
        _log(ROUTE_EXEC, 200, sandbox_id)
        return {"stdout": stdout, "stderr": stderr, "exit_code": exit_code}

    @api.get("/v1/sandboxes/{sandbox_id}/files")
    async def read_file(sandbox_id: str, request: Request, path: str = ""):
        client = _client_of(request)
        entry = _entry(sandbox_id)
        if not path:
            raise BridgeError(400, "BAD_PARAMS", "Укажите путь к файлу в параметре path.")
        with _modal_errors(ROUTE_FILES_GET, sandbox_id):
            sandbox = _sandbox_handle(entry, client)
            try:
                data = sandbox.filesystem.read_bytes(path)
            except Exception as exc:  # noqa: BLE001 — отсутствие файла отдельно от сбоя Modal
                if _is_not_found(exc):
                    raise BridgeError(404, "FILE_NOT_FOUND", MESSAGE_FILE_NOT_FOUND) from None
                raise
        _log(ROUTE_FILES_GET, 200, sandbox_id)
        return Response(content=bytes(data), media_type="application/octet-stream")

    @api.put("/v1/sandboxes/{sandbox_id}/files")
    async def write_file(sandbox_id: str, request: Request, path: str = ""):
        client = _client_of(request)
        entry = _entry(sandbox_id)
        if not path:
            raise BridgeError(400, "BAD_PARAMS", "Укажите путь к файлу в параметре path.")
        data = await _raw_body(request)
        with _modal_errors(ROUTE_FILES_PUT, sandbox_id):
            sandbox = _sandbox_handle(entry, client)
            _fs_write_bytes(sandbox.filesystem, path, data)
        _log(ROUTE_FILES_PUT, 204, sandbox_id)
        return Response(status_code=204)

    @api.post("/v1/sandboxes/{sandbox_id}/stop")
    async def stop_sandbox(sandbox_id: str, request: Request):
        client = _client_of(request)
        entry = _entry(sandbox_id)
        with _modal_errors(ROUTE_STOP, sandbox_id):
            if entry.get("state") not in ("stopped", "failed", "expired"):
                try:
                    sandbox = _sandbox_handle(entry, client)
                    sandbox.terminate()
                except BridgeError as exc:
                    if exc.status != 404:
                        raise
        _mark(entry, "stopped")
        _log(ROUTE_STOP, 204, sandbox_id)
        return Response(status_code=204)

    @api.delete("/v1/sandboxes/{sandbox_id}")
    async def delete_sandbox(sandbox_id: str, request: Request):
        client = _client_of(request)
        entry = _entry(sandbox_id)
        with _modal_errors(ROUTE_DELETE, sandbox_id):
            try:
                sandbox = _sandbox_handle(entry, client)
                sandbox.terminate()
            except BridgeError as exc:
                if exc.status != 404:
                    raise
        sandbox_map.pop(sandbox_id, None)
        _log(ROUTE_DELETE, 204, sandbox_id)
        return Response(status_code=204)

    return api
