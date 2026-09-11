---
id: intent-2026-09-02-rox-product-program
type: intent-issue
date: 2026-09-02
status: draft
bounded_context: rox-desktop-platform
---

# Intent: Rox local-first agent workspace

## Goal

Turn Rox into a coherent local-first macOS workspace where sessions, reproducible
pipelines, notes, tasks, calendars, browser context, memory and cloud execution
share one typed data model and one premium user experience.

## Domain terms

- **Session** — a conversation plus its immutable event/trace history.
- **WorkflowSpec** — a versioned, reproducible pipeline definition.
- **Run** — an execution of one WorkflowSpec version with typed artifacts.
- **Local vault** — canonical Markdown files plus rebuildable indexes.
- **Knowledge entity** — a typed reference extracted from notes/sessions.
- **Memory proposal** — an editable candidate fact/rule awaiting scope approval.
- **Browser profile** — an encrypted operational partition, never Knowledge text.
- **Account replica** — an encrypted server copy for recovery and continuity.
- **Collaboration** — authenticated shared editing; distinct from publication.
- **Rox CLI** — the branded OMP-compatible runtime exposed by Rox.

## Boundaries

**Always**

- Local notes, tasks and session history remain usable offline.
- Markdown is canonical; SQLite/search/vector indexes are rebuildable.
- Cloud authorization is derived from authenticated account membership, never a
  renderer-supplied workspace id.
- Cookies, passwords, passkeys and tokens remain outside searchable Knowledge.
- Every destructive, published or collaborative action has an explicit state,
  audit event and recovery/rollback path.

**Ask first / decision gates**

- Legal terms for account replicas, product-improvement use and model training.
- Import of browser credentials requiring OS/Keychain consent.
- Any new paid provider or unbounded cloud spend.
- Public publication or trust-boundary expansion.

**Never**

- A cosmetic checkbox that claims sync is disabled while hidden uploads continue.
- Silent storage of raw passwords/cookies in Postgres, S3, logs or embeddings.
- Automatic fallback from Daytona to Cloudflare/Modal/E2B.
- SiYuan as a required local-note dependency.

## Acceptance examples

```gherkin
Feature: Rox unified local-first workspace

  Scenario: Local note works offline
    Given the user has a Rox workspace and no network connection
    When the user creates, links and edits a note
    Then the canonical Markdown file is saved locally
    And no optional kernel or cloud service is required

  Scenario: Session becomes a reproducible pipeline
    Given a completed agent session
    When the user opens Map and promotes its trace to a workflow draft
    Then typed nodes and edges can be edited and versioned
    And reopening the workflow reproduces the same graph and layout

  Scenario: Browser state survives navigation
    Given an authenticated page in the embedded Rox browser
    When the user switches between Sessions, Notes and Browser
    Then the same browser partition, cookies and page state remain available
    And only explicit Close destroys the browser instance

  Scenario: Credentials remain operational secrets
    Given browser profile import is available
    When the user imports selected credentials with OS approval
    Then credentials enter the encrypted credential/browser vault
    And they never enter Knowledge search, prompts, logs or account replica text

  Scenario: Memory is proposed rather than silently learned
    Given a session contains a stable preference or reusable rule
    When the memory extraction workflow runs
    Then Rox shows an editable proposal with global, project and reject actions
    And nothing becomes durable until the user chooses a scope

  Scenario: Cloud run uses Daytona only
    Given a configured Daytona credential reference and bounded budget
    When the user starts a cloud run
    Then lifecycle, artifacts, cost and cancellation are visible in Rox
    And failure never falls back to another provider

  Scenario: Collaboration enforces membership
    Given a user creates a "Позвать Бро" invitation
    When another authenticated Rox user follows the one-time invite
    Then the server validates membership before granting session access
    And publication remains a separate read-only action

  Scenario: Collection navigation stays fast
    Given a workspace with 2,000 sessions and a large local vault
    When the user switches between List, Table, Kanban, Heatmap, Map and Notes
    Then cached view switches meet the declared p95 budgets
    And no startup N+1 scan blocks the renderer

  Scenario: Voice remains user-controlled
    Given local speech models are installed or a cloud option is selected
    When the user dictates or requests playback
    Then the active engine and retention policy are visible
    And wake-word listening is disabled until explicitly enabled

  Scenario: Branding hides implementation details
    Given a normal Rox user interface
    When the user configures an agent or provider
    Then visible copy uses Rox, Rox CLI and the agent's chosen identity
    And OMP, Pi, Craft and Hermes remain compatibility implementation terms only
```
