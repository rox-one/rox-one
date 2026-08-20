# G2 — Licensing decision record (managed kernel)

> **Status: ACCEPTED**  
> **Chosen variant: C — OEM**  
> **Date accepted:** 2026-08-20  
> **Date opened:** 2026-08-08  
> **Parent:** [08-licensing.md](./08-licensing.md) (K-08)  
> **Ticket 14:** [plans/next-program/decisions/001-g2-managed-siyuan.md](../../../plans/next-program/decisions/001-g2-managed-siyuan.md)

## Decision

**Variant C (OEM / commercial white-label).**

Rox may bundle, modify, white-label, and ship the knowledge kernel **inside Rox** as an OEM-managed payload. The product surface is Rox «Знания», not an upstream notes brand. The kernel chrome (shell, locale, catalog) may be rewritten under this grant.

This is an **extended OEM license**: any platform Rox ships is in scope. Named now: Windows, macOS, Linux (including Debian), Android, iOS. Desktop v1 still ships macOS / Windows / Linux; mobile follows the same grant when those clients exist.

**Not chosen:** B (AGPL-compatible publication of the combined volume). **A (external-local)** remains a supported fallback for developers and BYO vaults, not the production default after the installer payload exists.

## What C unlocks

- Runtime `mode: 'managed'` is **allowed** when `G2_RECORD_PATH` points at this record and the installer provides `OEM_PIN_PATH` + `OEM_KERNEL_BINARY` with a matching pin checksum.
- White-label fork lives in the private repo `rox-one/knowledge-engine`. Sources of that fork **must not** enter the Apache `rox-one/rox-one` git history.
- Installer ships a pinned binary + sha256; the public repo holds only the pin manifest.

## What C does not do by itself

- It does **not** add a kernel binary to this repository.
- It does **not** skip checksum validation.
- G1 usage metrics remain a *release-notes* gate for calling managed “the only supported mode”; they do not revert this legal choice.

## Platforms (grant)

| Platform | In grant | v1 desktop installer |
|---|---|---|
| macOS (arm64, x64) | yes | yes |
| Windows (x64) | yes | yes |
| Linux / Debian (x64) | yes | yes |
| Android | yes | later client |
| iOS | yes | later client |
| Any other platform Rox ships | yes | as shipped |

## Shell / product

- Host chrome: Rox. User copy: Знания / ядро знаний.
- Kernel process: hidden, loopback, ephemeral port ≠ 6806.
- Integrated editor honors `craftIntegrated=1`.
- Plugin ABI preserved; catalog is OEM-only (`ROX_CATALOG_URL` / empty allowlist).
