"""Synchronous Rox Cloud API client built on the standard library only.

Every HTTP call goes through a :data:`Transport` callable, so a test can
replace the network with a fake::

    transport(method, url, headers, body) -> (status, headers, body)

The API key travels only in the ``Authorization`` header. It never appears in
a URL, a response object or an error message.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Callable, Iterable

from .errors import RoxApiError

DEFAULT_TIMEOUT = 20.0
USER_AGENT = "rox-cloud-python/0.1.0"

Transport = Callable[
    [str, str, dict[str, str], bytes | None],
    tuple[int, dict[str, str], bytes],
]
JsonObject = dict[str, Any]


def _lower_headers(items: Iterable[tuple[str, Any]]) -> dict[str, str]:
    return {str(key).lower(): str(value) for key, value in items}


def _urllib_transport(timeout: float) -> Transport:
    """The real transport: ``urllib.request`` with a socket timeout."""

    def transport(
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes | None,
    ) -> tuple[int, dict[str, str], bytes]:
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return (
                    response.status,
                    _lower_headers(response.headers.items()),
                    response.read(),
                )
        except urllib.error.HTTPError as exc:
            # urllib raises on 4xx/5xx; the client wants the envelope instead.
            try:
                error_body = exc.read()
            except OSError:
                error_body = b""
            finally:
                exc.close()
            return (
                exc.code,
                _lower_headers(exc.headers.items() if exc.headers else []),
                error_body,
            )

    return transport


def _segment(value: Any) -> str:
    return urllib.parse.quote(str(value), safe="")


class RoxClient:
    """Client for one Rox Cloud tenant.

    Args:
        base_url: API root such as ``https://api.rox.one`` or
            ``http://localhost:8787``.
        api_key: Tenant key ``rox_sk_live_…``. Sent in the ``Authorization``
            header on every request.
        transport: Optional callable that replaces HTTP; the tests inject a
            fake here and never touch the network.
        timeout: Socket timeout in seconds for the built-in transport.
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        transport: Transport | None = None,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        if not isinstance(api_key, str) or not api_key:
            raise ValueError("api_key must be a non-empty string")
        if not isinstance(base_url, str) or not base_url.strip():
            raise ValueError("base_url must be an absolute http(s) URL")
        base = base_url.strip().rstrip("/")
        parsed = urllib.parse.urlsplit(base)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("base_url must be an absolute http(s) URL")
        if timeout is None or float(timeout) <= 0:
            raise ValueError("timeout must be a positive number of seconds")

        self._base_url = base
        self._api_key = api_key
        self._timeout = float(timeout)
        self._transport: Transport = (
            transport if transport is not None else _urllib_transport(self._timeout)
        )

        self.sandboxes = _Sandboxes(self)
        self.keys = _Keys(self)
        self.account = _Account(self)
        self.provider_credentials = _ProviderCredentials(self)

    def __repr__(self) -> str:
        return f"RoxClient(base_url={self._base_url!r})"

    # -- plumbing ---------------------------------------------------------

    def _redact(self, text: str) -> str:
        return text.replace(self._api_key, "[redacted]") if self._api_key else text

    def _request(
        self,
        method: str,
        path: str,
        *,
        query: Iterable[tuple[str, Any]] | None = None,
        body: JsonObject | None = None,
        data: bytes | None = None,
        idempotency_key: str | None = None,
        expect: str = "json",
    ) -> Any:
        if body is not None and data is not None:
            raise ValueError("pass either body or data, not both")

        url = self._base_url + path
        pairs = [(name, str(value)) for name, value in (query or []) if value is not None]
        if pairs:
            url = f"{url}?{urllib.parse.urlencode(pairs)}"

        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self._api_key}",
            "User-Agent": USER_AGENT,
        }
        payload: bytes | None = None
        if data is not None:
            payload = bytes(data)
            headers["Content-Type"] = "application/octet-stream"
        elif body is not None:
            payload = json.dumps(body, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key

        try:
            status, response_headers, response_body = self._transport(
                method, url, headers, payload
            )
        except OSError as exc:
            # URLError, socket timeouts and connection resets all land here.
            reason = getattr(exc, "reason", None) or str(exc) or exc.__class__.__name__
            raise RoxApiError(
                status=0,
                code="network_error",
                type="connection_error",
                request_id=None,
                message=self._redact(f"request to Rox Cloud failed: {reason}"),
            ) from exc

        status = int(status)
        headers_lower = _lower_headers((response_headers or {}).items())
        request_id = headers_lower.get("x-request-id") or None
        raw = response_body or b""

        if status < 200 or status >= 300:
            raise self._api_error(status, request_id, raw)

        if expect == "bytes":
            return bytes(raw)

        if status == 204 or not raw:
            return None

        try:
            decoded = json.loads(raw)
        except (UnicodeDecodeError, ValueError) as exc:
            raise RoxApiError(
                status=status,
                code="invalid_response",
                type="api_error",
                request_id=request_id,
                message="Rox Cloud returned a body that is not valid JSON",
            ) from exc
        if not isinstance(decoded, dict):
            raise RoxApiError(
                status=status,
                code="invalid_response",
                type="api_error",
                request_id=request_id,
                message="Rox Cloud returned a JSON value that is not an object",
            )
        return decoded

    def _api_error(
        self,
        status: int,
        header_request_id: str | None,
        body: bytes,
    ) -> RoxApiError:
        envelope: Any = None
        if body:
            try:
                envelope = json.loads(body)
            except (UnicodeDecodeError, ValueError):
                envelope = None
        error = envelope.get("error") if isinstance(envelope, dict) else None
        if isinstance(error, dict):
            message = error.get("message")
            request_id = error.get("request_id") or header_request_id
            return RoxApiError(
                status=status,
                code=str(error.get("code") or "unknown_error"),
                type=str(error.get("type") or "api_error"),
                request_id=str(request_id) if request_id else None,
                message=self._redact(str(message))
                if message
                else f"Rox Cloud returned HTTP {status}",
            )
        return RoxApiError(
            status=status,
            code="invalid_response",
            type="api_error",
            request_id=header_request_id,
            message=(
                f"Rox Cloud returned HTTP {status} "
                "without a readable error envelope"
            ),
        )


class _Sandboxes:
    """``/v1/sandboxes`` operations."""

    def __init__(self, client: RoxClient) -> None:
        self._client = client

    def create(
        self,
        os: str = "linux",
        cpu: float = 2,
        memory_gb: float = 4,
        ttl_sec: int | None = None,
        provider: str | None = None,
        idempotency_key: str | None = None,
    ) -> JsonObject:
        """Boot a sandbox on the tenant's own provider credential.

        A fresh ``uuid4`` is used as ``Idempotency-Key`` when none is given,
        so a retried call cannot boot a second machine by accident.
        """
        body: JsonObject = {"os": os, "cpu": cpu, "memoryGb": memory_gb}
        if ttl_sec is not None:
            body["ttlSec"] = ttl_sec
        if provider is not None:
            body["provider"] = provider
        key = idempotency_key or str(uuid.uuid4())
        return self._client._request(
            "POST", "/v1/sandboxes", body=body, idempotency_key=key
        )

    def get(self, id: str) -> JsonObject:
        """Read one sandbox."""
        return self._client._request("GET", f"/v1/sandboxes/{_segment(id)}")

    def list(
        self,
        limit: int | None = None,
        starting_after: str | None = None,
    ) -> JsonObject:
        """One page of sandboxes plus ``has_more`` and ``next_cursor``."""
        return self._client._request(
            "GET",
            "/v1/sandboxes",
            query=[("limit", limit), ("starting_after", starting_after)],
        )

    def exec(
        self,
        id: str,
        command: str,
        timeout_sec: float | None = None,
    ) -> JsonObject:
        """Run a command; the result carries ``exit_code``, ``stdout`` and ``stderr``."""
        body: JsonObject = {"command": command}
        if timeout_sec is not None:
            body["timeoutSec"] = timeout_sec
        return self._client._request(
            "POST", f"/v1/sandboxes/{_segment(id)}/exec", body=body
        )

    def read_file(self, id: str, path: str) -> bytes:
        """Download a file as raw bytes."""
        return self._client._request(
            "GET",
            f"/v1/sandboxes/{_segment(id)}/files",
            query=[("path", path)],
            expect="bytes",
        )

    def write_file(self, id: str, path: str, data: bytes | bytearray | memoryview | str) -> None:
        """Upload raw bytes to a path inside the sandbox."""
        if isinstance(data, str):
            payload = data.encode("utf-8")
        elif isinstance(data, (bytes, bytearray, memoryview)):
            payload = bytes(data)
        else:
            raise TypeError("data must be bytes, bytearray, memoryview or str")
        return self._client._request(
            "PUT",
            f"/v1/sandboxes/{_segment(id)}/files",
            query=[("path", path)],
            data=payload,
        )

    def stop(self, id: str) -> JsonObject:
        """Stop a sandbox without deleting it."""
        return self._client._request("POST", f"/v1/sandboxes/{_segment(id)}/stop")

    def delete(self, id: str) -> None:
        """Destroy a sandbox; the API answers ``204``."""
        return self._client._request("DELETE", f"/v1/sandboxes/{_segment(id)}")


class _Keys:
    """``/v1/keys`` operations."""

    def __init__(self, client: RoxClient) -> None:
        self._client = client

    def create(self, scopes: Iterable[str]) -> JsonObject:
        """Mint an API key; the response carries the secret exactly once."""
        if isinstance(scopes, str):
            raise ValueError("scopes must be a sequence of scope strings, not a string")
        return self._client._request(
            "POST", "/v1/keys", body={"scopes": list(scopes)}
        )

    def list(self) -> JsonObject:
        """Key metadata only; secrets are never returned."""
        return self._client._request("GET", "/v1/keys")

    def revoke(self, id: str) -> None:
        """Revoke a key; it stops authenticating immediately."""
        return self._client._request("DELETE", f"/v1/keys/{_segment(id)}")


class _Account:
    """``/v1/account`` operations."""

    def __init__(self, client: RoxClient) -> None:
        self._client = client

    def get(self) -> JsonObject:
        """Balance and month limits; money is integer cents plus a USD string."""
        return self._client._request("GET", "/v1/account")

    def top_up(self, amount_cents: int) -> JsonObject:
        """Add credit to the tenant wallet. ``amount_cents`` is an integer."""
        if (
            isinstance(amount_cents, bool)
            or not isinstance(amount_cents, int)
            or amount_cents < 1
        ):
            raise ValueError("amount_cents must be a positive integer number of cents")
        return self._client._request(
            "POST", "/v1/account/topup", body={"amountCents": amount_cents}
        )


class _ProviderCredentials:
    """``/v1/provider-credentials`` operations."""

    def __init__(self, client: RoxClient) -> None:
        self._client = client

    def add(
        self,
        provider: str,
        label: str,
        secret: str,
        spend_cap_cents: int,
        regions: Iterable[str] | None = None,
        products: Iterable[str] | None = None,
    ) -> JsonObject:
        """Store a customer-owned provider key; only metadata comes back."""
        if (
            isinstance(spend_cap_cents, bool)
            or not isinstance(spend_cap_cents, int)
            or spend_cap_cents < 0
        ):
            raise ValueError("spend_cap_cents must be an integer number of cents")
        body: JsonObject = {
            "provider": provider,
            "label": label,
            "secret": secret,
            "spendCapCents": spend_cap_cents,
        }
        if regions is not None:
            body["regions"] = list(regions)
        if products is not None:
            body["products"] = list(products)
        return self._client._request("POST", "/v1/provider-credentials", body=body)

    def list(self) -> JsonObject:
        """One entry per stored key of this tenant, metadata only."""
        return self._client._request("GET", "/v1/provider-credentials")

    def promote(self, id: str) -> JsonObject:
        """Make this key the only active one for its provider."""
        return self._client._request(
            "POST", f"/v1/provider-credentials/{_segment(id)}/promote"
        )

    def disable(self, id: str) -> JsonObject:
        """Turn a provider key off; it stays visible with status ``disabled``."""
        return self._client._request(
            "DELETE", f"/v1/provider-credentials/{_segment(id)}"
        )
