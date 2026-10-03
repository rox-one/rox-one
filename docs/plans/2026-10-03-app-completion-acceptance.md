# App completion acceptance — 2026-10-03

Each row requires a concrete behavior check. Existing drafts in the working tree are preserved and audited; source existence alone is not completion. Native Windows/macOS compositor and OS prompts require hardware evidence. API keys are kept outside the repository; provider validation and account-wide deployment are separately verified.

| Requirement | Evidence needed | Status |
| --- | --- | --- |
| Login and profile creation | Native-authenticated user can load/update own profile, cancellation/retry correct, no other-user profile access | In progress |
| Transcription | Actual Deepgram request succeeds; latest supported prerecorded model and latest diarization, paragraphs/timestamps rendered | In progress; live API blocked by environment policy |
| Own-message likes | User message reaction persists after canonical server event and reload | In progress |
| Fork and branch | Branch from chosen user or assistant message ends at that message and opens usable session | In progress |
| Message action bar | Like, Copy, Quote, Listen, Branch, More visible and functional | In progress |
| Memory | Populated memory readable, subdued metadata, search/filter/details, narrow layouts | In progress |
| Default services | E2B/Exa/Firecrawl/Brave enabled and tools usable for fresh/existing users; working keys validated on actual backend | In progress; deployment host unknown |
| Widget design | Per-widget preset/color/saturation/contrast controls, reset, preview and reload persistence | In progress |
| Skill installation | Same-name bundled skills coexist in app-owned storage; links do not overwrite user skills | Pending |
| Meeting extraction | Automatic prompt extracts tasks/decisions once; user edits persist through refresh/re-extraction | Pending |
| Radar | Clear setup and real source-backed sweep, result/error/retry states, persisted schedule | Pending |
| Quests | Distinct icon cards, real XP, personal competition/progress, native actor-scoped profile APIs | Pending |
| Security | Actual active Rox runtime visible; optional OpenClaw correctly described; failures independent | Pending |
| Inbox | Actual items prominent, accessible switches, selection actions only relevant, calm empty state | Pending |
| Original shell | Top/left/right translucent +fallback, rounded edges, no duplicate inner navigation | Pending recheck |
| Original navigation | All sections nested/colored, icon reveals labels, label expands, sessions/status/labels/archive/favorites/new/join | Pending recheck |
| Original top navigation | Home/Sessions/Meetings/Tasks/Notes/Feed/Inbox pills and Cmd/Ctrl+1–7 | Pending recheck |
| Original profile | Fixed avatar/name/plan/balance/settings/footer across pages and compact/zoom | Pending recheck |
| Original widget sizes | All20 widgets S/M/L alter height and width with persisted sizes | Pending recheck |
| Original map | Camera/add, tools/conditions/output/frame, translucent colors, saved connections/geometry | Pending recheck |
| Original model defaults | Runtime Rox and rox/r1-max; one builtin Rox R1 Max plus user-connected catalogs; Chat label | Pending recheck |
| Original session actions | Overview, invite, share, explicit join URL work including failure/context changes | Pending recheck |
| Original defaults/import | Selected import preferences, truthful permission boundary, profile history/bookmarks/password outcomes | Pending recheck; referenced screenshot absent |
| Final integration | Application actually starts; relevant UI/network/native tests, package types/builds/locales, independent review | Pending |
