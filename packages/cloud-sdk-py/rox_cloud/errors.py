"""The single public error type of the Rox Cloud client."""

from __future__ import annotations


class RoxApiError(Exception):
    """A failed Rox Cloud call.

    ``status`` is the HTTP status, or ``0`` when the request never reached the
    API. ``code`` is the server's stable error code, or a client-side one:
    ``network_error`` or ``invalid_response``. ``message`` is passed through
    from the server unchanged (the API writes it in Russian).

    The API key is never stored on this object and never appears in the text.
    """

    def __init__(
        self,
        *,
        status: int,
        code: str,
        type: str,
        request_id: str | None = None,
        message: str = "",
    ) -> None:
        self.status = status
        self.code = code
        self.type = type
        self.request_id = request_id
        self.message = message
        super().__init__(message)

    def __str__(self) -> str:
        details = [f"status={self.status}", f"code={self.code}", f"type={self.type}"]
        if self.request_id:
            details.append(f"request_id={self.request_id}")
        suffix = "; ".join(details)
        return f"{self.message} ({suffix})" if self.message else suffix
