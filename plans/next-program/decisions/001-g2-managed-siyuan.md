# 001 — G2 managed kernel: variant C (OEM)

Ticket 14. Parent record: [`docs/specs/2026-08-07-siyuan-integration/g2-decision-record.md`](../../../docs/specs/2026-08-07-siyuan-integration/g2-decision-record.md).

**Status: ACCEPTED** — **variant C** (OEM / white-label). Date: 2026-08-20.

**Owner:** product (human decision recorded here).

## Decision

OEM/commercial grant to bundle, modify, white-label, and ship the knowledge kernel inside Rox on **any platform Rox ships** (Windows, macOS, Linux including Debian, Android, iOS). Desktop v1 still targets macOS, Windows, Linux; mobile is in the grant, not the first installer.

Apache `rox-one/rox-one` still must not contain kernel sources. Payload is a pinned installer binary. Private fork: `rox-one/knowledge-engine`.

**B** is not chosen. **A** remains a developer / BYO fallback.

## Runtime

Managed spawn is allowed when this parent record is ACCEPTED C **and** `OEM_PIN_PATH` + `OEM_KERNEL_BINARY` pass checksum. Missing payload → fall back to external-local, do not download a kernel.
