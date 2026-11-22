"""Tests for the Rox Cloud Python client. No network is used."""

from __future__ import annotations

import json
import sys
import unittest
import urllib.error
import urllib.parse
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rox_cloud import RoxApiError, RoxClient

BASE_URL = "https://api.example.test"
API_KEY = "rox_sk_live_0123456789abcdef0123456789abcdef"
REQUEST_ID = "req_0123456789abcdef01234567"


def json_response(status, payload, headers=None):
    merged = {"content-type": "application/json"}
    merged.update(headers or {})
    body = (
        b""
        if payload is None
        else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    )
    return status, merged, body


def account_payload():
    return {
        "object": "account",
        "balance_cents": 1500,
        "reserved_cents": 0,
        "month_spent_cents": 250,
        "monthly_cap_cents": 0,
        "rate_cents_per_hour": None,
        "currency": "USD",
        "balance_usd": "15.00",
    }


class FakeTransport:
    """Records every call and replays queued responses (or raises them)."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, method, url, headers, body):
        self.calls.append(
            {"method": method, "url": url, "headers": dict(headers), "body": body}
        )
        if not self.responses:
            raise AssertionError(f"unexpected call: {method} {url}")
        item = self.responses.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item

    @property
    def last(self):
        return self.calls[-1]

    def path(self, index=-1):
        return urllib.parse.urlsplit(self.calls[index]["url"]).path

    def query(self, index=-1):
        return urllib.parse.parse_qs(
            urllib.parse.urlsplit(self.calls[index]["url"]).query
        )


def make_client(transport):
    return RoxClient(BASE_URL, API_KEY, transport=transport)


class AuthTests(unittest.TestCase):
    def test_sends_bearer_auth_and_keeps_key_out_of_the_url(self):
        transport = FakeTransport(json_response(200, account_payload()))
        client = make_client(transport)

        client.account.get()

        headers = transport.last["headers"]
        self.assertEqual(headers["Authorization"], f"Bearer {API_KEY}")
        self.assertEqual(headers["Accept"], "application/json")
        self.assertEqual(headers["User-Agent"], "rox-cloud-python/0.1.0")
        self.assertEqual(transport.last["method"], "GET")
        self.assertEqual(transport.path(), "/v1/account")
        self.assertNotIn(API_KEY, transport.last["url"])
        self.assertNotIn(API_KEY, repr(client))

    def test_requires_an_api_key(self):
        with self.assertRaises(ValueError):
            RoxClient(BASE_URL, "", transport=FakeTransport())
        with self.assertRaises(ValueError):
            RoxClient("not-a-url", API_KEY, transport=FakeTransport())


class SandboxTests(unittest.TestCase):
    def test_create_generates_an_idempotency_key(self):
        transport = FakeTransport(
            json_response(201, {"id": "sbx_1", "object": "sandbox"}),
            json_response(201, {"id": "sbx_2", "object": "sandbox"}),
        )
        client = make_client(transport)

        client.sandboxes.create()
        key = transport.calls[0]["headers"]["Idempotency-Key"]
        self.assertEqual(uuid.UUID(key).version, 4)
        self.assertEqual(
            json.loads(transport.calls[0]["body"]),
            {"os": "linux", "cpu": 2, "memoryGb": 4},
        )
        self.assertEqual(transport.path(0), "/v1/sandboxes")

        client.sandboxes.create(
            os="windows",
            cpu=4,
            memory_gb=8,
            ttl_sec=600,
            provider="daytona",
            idempotency_key="fixed-key",
        )
        self.assertEqual(transport.calls[1]["headers"]["Idempotency-Key"], "fixed-key")
        self.assertEqual(
            json.loads(transport.calls[1]["body"]),
            {
                "os": "windows",
                "cpu": 4,
                "memoryGb": 8,
                "ttlSec": 600,
                "provider": "daytona",
            },
        )

    def test_exec_parses_exit_code(self):
        transport = FakeTransport(
            json_response(
                200, {"stdout": "hi\n", "stderr": "", "exit_code": 7}
            )
        )
        client = make_client(transport)

        result = client.sandboxes.exec("sbx_1", "sh -c 'exit 7'", timeout_sec=30)

        self.assertEqual(result["exit_code"], 7)
        self.assertEqual(result["stdout"], "hi\n")
        self.assertEqual(transport.last["method"], "POST")
        self.assertEqual(transport.path(), "/v1/sandboxes/sbx_1/exec")
        self.assertEqual(
            json.loads(transport.last["body"]),
            {"command": "sh -c 'exit 7'", "timeoutSec": 30},
        )

    def test_file_bytes_round_trip(self):
        payload = b"\x00\x01binary\xff\n"
        transport = FakeTransport(
            (204, {}, b""),
            (200, {"content-type": "application/octet-stream"}, payload),
            (200, {"content-type": "application/octet-stream"}, b""),
        )
        client = make_client(transport)

        self.assertIsNone(client.sandboxes.write_file("sbx_1", "/tmp/data.bin", payload))
        write = transport.calls[0]
        self.assertEqual(write["method"], "PUT")
        self.assertEqual(transport.path(0), "/v1/sandboxes/sbx_1/files")
        self.assertEqual(transport.query(0), {"path": ["/tmp/data.bin"]})
        self.assertEqual(write["body"], payload)
        self.assertEqual(write["headers"]["Content-Type"], "application/octet-stream")

        self.assertEqual(client.sandboxes.read_file("sbx_1", "/tmp/data.bin"), payload)
        read = transport.calls[1]
        self.assertEqual(read["method"], "GET")
        self.assertEqual(transport.path(1), "/v1/sandboxes/sbx_1/files")
        self.assertEqual(transport.query(1), {"path": ["/tmp/data.bin"]})

        self.assertEqual(client.sandboxes.read_file("sbx_1", "/tmp/empty"), b"")

    def test_write_file_accepts_text(self):
        transport = FakeTransport((204, {}, b""))
        client = make_client(transport)

        client.sandboxes.write_file("sbx_1", "/tmp/hello.txt", "привет")

        self.assertEqual(transport.last["body"], "привет".encode("utf-8"))

    def test_list_sends_cursor_query_and_returns_the_page(self):
        page = {
            "object": "list",
            "data": [{"id": "sbx_2", "object": "sandbox"}],
            "has_more": True,
            "next_cursor": "sbx_2",
        }
        transport = FakeTransport(json_response(200, page))
        client = make_client(transport)

        result = client.sandboxes.list(limit=5, starting_after="sbx_last")

        self.assertEqual(result, page)
        self.assertEqual(transport.query(), {"limit": ["5"], "starting_after": ["sbx_last"]})
        self.assertEqual(transport.path(), "/v1/sandboxes")

    def test_list_omits_unset_query_parameters(self):
        transport = FakeTransport(json_response(200, {"object": "list", "data": [], "has_more": False, "next_cursor": None}))
        client = make_client(transport)

        client.sandboxes.list()

        self.assertEqual(urllib.parse.urlsplit(transport.last["url"]).query, "")

    def test_stop_and_delete_paths(self):
        transport = FakeTransport(
            json_response(200, {"id": "sbx_1", "state": "stopped"}),
            (204, {"x-request-id": REQUEST_ID}, b""),
        )
        client = make_client(transport)

        stopped = client.sandboxes.stop("sbx_1")
        self.assertEqual(stopped["state"], "stopped")
        self.assertEqual(transport.last["method"], "POST")
        self.assertEqual(transport.path(), "/v1/sandboxes/sbx_1/stop")

        self.assertIsNone(client.sandboxes.delete("sbx_1"))
        self.assertEqual(transport.last["method"], "DELETE")
        self.assertEqual(transport.path(), "/v1/sandboxes/sbx_1")


class ErrorTests(unittest.TestCase):
    def test_error_envelope_keeps_request_id_and_russian_message(self):
        error = {
            "type": "payment_required",
            "code": "insufficient_balance",
            "message": "На счёте недостаточно средств.",
            "request_id": REQUEST_ID,
        }
        transport = FakeTransport(
            json_response(
                402,
                {"error": error},
                {"x-request-id": REQUEST_ID},
            )
        )
        client = make_client(transport)

        with self.assertRaises(RoxApiError) as caught:
            client.sandboxes.create()

        err = caught.exception
        self.assertEqual(err.status, 402)
        self.assertEqual(err.code, "insufficient_balance")
        self.assertEqual(err.type, "payment_required")
        self.assertEqual(err.request_id, REQUEST_ID)
        self.assertEqual(err.message, "На счёте недостаточно средств.")
        self.assertIn("На счёте недостаточно средств.", str(err))
        self.assertIn(REQUEST_ID, str(err))

    def test_error_envelope_falls_back_to_the_header_request_id(self):
        transport = FakeTransport(
            json_response(
                401,
                {"error": {"type": "authentication_error", "code": "authentication_required", "message": "Нужен ключ."}},
                {"x-request-id": REQUEST_ID},
            )
        )
        client = make_client(transport)

        with self.assertRaises(RoxApiError) as caught:
            client.account.get()

        self.assertEqual(caught.exception.request_id, REQUEST_ID)

    def test_204_delete_returns_none(self):
        transport = FakeTransport(
            (204, {"x-request-id": REQUEST_ID}, b""),
            (204, {"x-request-id": REQUEST_ID}, b""),
        )
        client = make_client(transport)

        self.assertIsNone(client.keys.revoke("key_1"))
        self.assertEqual(transport.last["method"], "DELETE")
        self.assertEqual(transport.path(), "/v1/keys/key_1")
        self.assertIsNone(client.sandboxes.delete("sbx_1"))

    def test_network_failure_becomes_network_error(self):
        transport = FakeTransport(urllib.error.URLError("connection refused"))
        client = make_client(transport)

        with self.assertRaises(RoxApiError) as caught:
            client.account.get()

        err = caught.exception
        self.assertEqual(err.status, 0)
        self.assertEqual(err.code, "network_error")
        self.assertEqual(err.type, "connection_error")
        self.assertIsNone(err.request_id)
        self.assertIn("connection refused", err.message)

    def test_unreadable_error_body_becomes_invalid_response(self):
        transport = FakeTransport(
            (502, {"x-request-id": REQUEST_ID}, b"<html>bad gateway</html>")
        )
        client = make_client(transport)

        with self.assertRaises(RoxApiError) as caught:
            client.sandboxes.get("sbx_1")

        err = caught.exception
        self.assertEqual(err.status, 502)
        self.assertEqual(err.code, "invalid_response")
        self.assertEqual(err.request_id, REQUEST_ID)

    def test_unreadable_success_body_becomes_invalid_response(self):
        transport = FakeTransport((200, {"content-type": "application/json"}, b"not json"))
        client = make_client(transport)

        with self.assertRaises(RoxApiError) as caught:
            client.account.get()

        self.assertEqual(caught.exception.code, "invalid_response")
        self.assertEqual(caught.exception.status, 200)

    def test_key_never_appears_in_error_text(self):
        transport = FakeTransport(
            urllib.error.URLError(f"tunnel rejected credential {API_KEY}")
        )
        client = make_client(transport)

        with self.assertRaises(RoxApiError) as caught:
            client.account.get()

        err = caught.exception
        self.assertNotIn(API_KEY, err.message)
        self.assertNotIn(API_KEY, str(err))
        self.assertNotIn(API_KEY, repr(err))


class KeysAccountAndCredentialsTests(unittest.TestCase):
    def test_every_path_matches_the_api(self):
        transport = FakeTransport(
            json_response(201, {"id": "key_1", "secret": "rox_sk_live_new"}),
            json_response(200, {"object": "list", "data": []}),
            (204, {}, b""),
            json_response(200, account_payload()),
            json_response(200, account_payload()),
            json_response(201, {"id": "cred_1"}),
            json_response(200, {"object": "list", "data": []}),
            json_response(200, {"id": "cred_1", "status": "active"}),
            json_response(200, {"id": "cred_1", "status": "disabled"}),
            json_response(201, {"id": "sbx_1", "object": "sandbox"}),
            json_response(200, {"id": "sbx_1", "object": "sandbox"}),
            json_response(200, {"object": "list", "data": [], "has_more": False, "next_cursor": None}),
            json_response(200, {"stdout": "", "stderr": "", "exit_code": 0}),
            (200, {"content-type": "application/octet-stream"}, b"hello"),
            (204, {}, b""),
            json_response(200, {"id": "sbx_1", "state": "stopped"}),
            (204, {}, b""),
        )
        client = make_client(transport)

        client.keys.create(["sandboxes:read"])
        client.keys.list()
        client.keys.revoke("key_1")
        client.account.get()
        client.account.top_up(500)
        client.provider_credentials.add("daytona", "main", "sk-provider-secret", 2500)
        client.provider_credentials.list()
        client.provider_credentials.promote("cred_1")
        client.provider_credentials.disable("cred_1")
        client.sandboxes.create()
        client.sandboxes.get("sbx_1")
        client.sandboxes.list(limit=1)
        client.sandboxes.exec("sbx_1", "true")
        client.sandboxes.read_file("sbx_1", "/etc/hostname")
        client.sandboxes.write_file("sbx_1", "/tmp/x", b"x")
        client.sandboxes.stop("sbx_1")
        client.sandboxes.delete("sbx_1")

        observed = [(call["method"], transport.path(index)) for index, call in enumerate(transport.calls)]
        self.assertEqual(
            observed,
            [
                ("POST", "/v1/keys"),
                ("GET", "/v1/keys"),
                ("DELETE", "/v1/keys/key_1"),
                ("GET", "/v1/account"),
                ("POST", "/v1/account/topup"),
                ("POST", "/v1/provider-credentials"),
                ("GET", "/v1/provider-credentials"),
                ("POST", "/v1/provider-credentials/cred_1/promote"),
                ("DELETE", "/v1/provider-credentials/cred_1"),
                ("POST", "/v1/sandboxes"),
                ("GET", "/v1/sandboxes/sbx_1"),
                ("GET", "/v1/sandboxes"),
                ("POST", "/v1/sandboxes/sbx_1/exec"),
                ("GET", "/v1/sandboxes/sbx_1/files"),
                ("PUT", "/v1/sandboxes/sbx_1/files"),
                ("POST", "/v1/sandboxes/sbx_1/stop"),
                ("DELETE", "/v1/sandboxes/sbx_1"),
            ],
        )
        for call in transport.calls:
            self.assertTrue(call["url"].startswith(BASE_URL + "/v1/"))
            self.assertNotIn(API_KEY, call["url"])
            self.assertEqual(call["headers"]["Authorization"], f"Bearer {API_KEY}")

        self.assertEqual(
            json.loads(transport.calls[0]["body"]), {"scopes": ["sandboxes:read"]}
        )
        self.assertEqual(
            json.loads(transport.calls[4]["body"]), {"amountCents": 500}
        )
        self.assertEqual(
            json.loads(transport.calls[5]["body"]),
            {
                "provider": "daytona",
                "label": "main",
                "secret": "sk-provider-secret",
                "spendCapCents": 2500,
            },
        )

    def test_top_up_keeps_money_in_integer_cents(self):
        transport = FakeTransport(json_response(200, account_payload()))
        client = make_client(transport)

        account = client.account.top_up(1500)

        self.assertEqual(json.loads(transport.last["body"]), {"amountCents": 1500})
        self.assertEqual(account["balance_cents"], 1500)
        self.assertEqual(account["balance_usd"], "15.00")
        with self.assertRaises(ValueError):
            client.account.top_up(15.0)

    def test_provider_credential_add_sends_optional_lists(self):
        transport = FakeTransport(json_response(201, {"id": "cred_1"}))
        client = make_client(transport)

        client.provider_credentials.add(
            provider="modal",
            label="backup",
            secret="sk-modal",
            spend_cap_cents=0,
            regions=["us-east"],
            products=["sandbox", "gpu"],
        )

        self.assertEqual(
            json.loads(transport.last["body"]),
            {
                "provider": "modal",
                "label": "backup",
                "secret": "sk-modal",
                "spendCapCents": 0,
                "regions": ["us-east"],
                "products": ["sandbox", "gpu"],
            },
        )

    def test_keys_create_rejects_a_bare_string(self):
        client = make_client(FakeTransport())

        with self.assertRaises(ValueError):
            client.keys.create("sandboxes:read")


if __name__ == "__main__":
    unittest.main()
