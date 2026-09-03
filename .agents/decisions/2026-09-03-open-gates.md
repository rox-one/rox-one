# Open decision gates — Wave 0 record

**Date:** 2026-09-03  
**Status:** OPEN — no legal, license, or commercial conclusions.  
**Source:** `.agents/plans/2026-09-02-rox-master-backlog.md` Boundaries + intent
`.agents/intents/2026-09-02-rox-product-program.md`.

These gates block product behavior. Do not implement gated features until a
named owner records a decision. This file only restates the open questions.

## DG-01 — Account replica and product-improvement purposes

**Status:** OPEN  
**Blocks:** Issue 01 (consent/deletion), Issue 27 (encrypted replica / device
sync), and any UI that claims sync, training, or replica purposes.

**Question (exact, from the plan):** legal text and explicit purposes for
account replica and product improvement/model training.

**Intent restatement (not an answer):** legal terms for account replicas,
product-improvement use and model training remain an ask-first gate.

## DG-02 — Privileged browser credential import

**Status:** OPEN  
**Blocks:** Issue 15 (privileged browser profile import).

**Question (exact, from the plan):** browser password/passkey import support
per OS and browser.

**Intent restatement (not an answer):** import of browser credentials requiring
OS/Keychain consent remains an ask-first gate.

## DG-03 — Public sharing retention and abuse SLA

**Status:** OPEN  
**Blocks:** Issue 28 (collaboration, “Позвать Бро”, sharing and publication).

**Question (exact, from the plan):** public sharing retention, abuse handling
and deletion SLA.

**Intent restatement (not an answer):** public publication or trust-boundary
expansion remains an ask-first gate.

## DG-04 — Paid Daytona sandbox quotas

**Status:** OPEN  
**Blocks:** Issue 25 (Daytona-only cloud runner), Issue 29 (paid Grok /
Daytona sandbox).

**Question (exact, from the plan):** paid-only Daytona sandbox quotas and
per-user cost ceiling.

**Intent restatement (not an answer):** any new paid provider or unbounded
cloud spend remains an ask-first gate. Daytona→other-provider fallback stays
forbidden regardless of this gate.

## DG-05 — Distributable Geist license

**Status:** OPEN  
**Blocks:** Issue 33 Geist-distribution work only. In-app Geist typography
already present in the baseline must not be re-litigated here.

**Question (exact, from the plan):** distributable Geist license/asset
decision.
