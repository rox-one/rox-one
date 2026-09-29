# Expected results and feature DoD

| Vertical outcome | Expected visible result | Data/proof required | Must reject |
|---|---|---|---|
| Shared Project | A opens; B denied neutral state | identity/server actor/membership/reload | client-forged user, title leak |
| Page | two carets/users, concurrent text, offline badge→ACK | canonical CRDT export after restart/reconnect | revoked writer, premature sync badge |
| Message→Task | toolbar dialog→task/source chip/Project/assignee notification | one task on retry, backlink, indexed/tool context | duplicate task, private excerpt leak |
| Inbound CRM | Contact/Company appear with provenance/mail link | replay dedup/domain filtering/last interaction | gmail.com fake company, implicit mail sharing |
| CRM discussion | @teammate, thread, attention/search/agent | shared Message primitive/audience | mention auto-share/private count |
| Calendar | slot create/move/resize/attendee updates | timezone/recurrence/provider read-back | fake adapter success/DST silent shift |
| Call | channel join/device/consent/archive/transcript/summary | tokenACL, same Call ID, raw spans/hash/citations | guest workspace access, double egress |
| Account context | company tabs linked native objects, agent context | same refs and per-source ACL | private emails in company-wide context |
| Recovery/release | restore with receipts and independent audits | outbox/search consistency/provider ambiguity/retention/SBOM | merely booted containers marked full parity |

Per-screen exact expected result is normative in contract files; per-WP domain API/schema/DB/test contract embedded in packet. Feature checklist below applies per package; N/A must state why and reviewer accept.

- [ ] UI/routing/layout/hover/focus/click/keyboard/help/accessibility
- [ ] entity IDs / persistence / commands / queries / revision/idempotency
- [ ] applicable realtime/presence/offline/reconnect
- [ ] unified permissions/share/revoke, legacy writes and tools denied
- [ ] search/mentions/notifications/activity/agent/memory/automation where applicable
- [ ] telemetry/redacted errors/loading/empty/unsupported/conflict states
- [ ] actual targeted tests / seeded failure / persistence/recovery/concurrency
- [ ] renderer screenshots+ARIA / macOS native / provider-live lanes as assigned
- [ ] source origins/licensing/schema migration/rollback/runbook
- [ ] independent review / commit / remote artifact read-back

No UI mock, JSON fixture, planning validator, provider token or cloud job done status alone closes these checks.
