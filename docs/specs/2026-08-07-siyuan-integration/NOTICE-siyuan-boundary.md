# NOTICE — knowledge kernel boundary

**The Apache Rox tree does not contain kernel sources.**

- `rox-one/rox-one` (Apache-2.0) does **not** vendor kernel source, unpacked UI, or a binary payload in git. Allowed: pin metadata (`oem-kernel-pin.json` version + sha256 + relative path).
- **G2 is ACCEPTED, variant C (OEM).** A licensed installer may ship a pinned kernel binary next to Rox. That payload is not part of the Apache source tree. See [g2-decision-record.md](./g2-decision-record.md).
- Host talks to the kernel over HTTP on loopback (managed) or a user-configured URL (external-local / remote). The renderer does not hold the access token.
- External-local remains valid: a user-run kernel is a separate program. Detection assist never downloads a kernel.
- White-label UI and locale live in the private OEM fork, not in this repository.

This notice is an engineering boundary statement, not legal advice.
