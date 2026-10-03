# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

- **Rox R1 Max default** — New sessions show Rox R1 Max (`rox/r1-max`) as the single built-in model; connected custom providers and locked session models remain available. The Standard mode is now named Chat. [#1391](https://github.com/rox-one/rox-one/pull/1391) · `ddf97e3`
- **Workspace navigation and appearance** — Rounded glass panels, a single expandable contextual sidebar, a persistent user profile and seven primary navigation pills with Cmd/Ctrl+1–7 shortcuts. Widgets now resize vertically and offer saved color, saturation and contrast presets. [#1391](https://github.com/rox-one/rox-one/pull/1391) · `ddf97e3`
- **Transcription and meeting follow-up** — Deepgram transcription selects the latest prerecorded model and diarizer, with speaker-separated paragraphs and timestamps. Meeting tasks and decisions are extracted automatically and remain editable. Shared services become available when their server credentials are configured. [#1391](https://github.com/rox-one/rox-one/pull/1391) · `ddf97e3`

## Improvements

- **Readable workspace tools** — Clearer memory cards and incoming items, calmer empty states, distinct quest cards and durable XP, and source-aware radar setup and results. Message actions expose Listen and Branch beside Like, Copy and Quote. [#1391](https://github.com/rox-one/rox-one/pull/1391) · `ddf97e3`

- **Zed-inspired appearance** — Added Nordfox - opaque, Min Dark (Blurred), and Siri Light palettes for the interface, code, and terminal. New installations start with Nordfox; existing theme choices remain intact.




- **Joined workspace panels** — Workspace panes now meet at one-pixel separators, with square panel corners, four-pixel controls and cards, and six-pixel menus and dialogs. Glass is limited to title bars, navigation, and inspector chrome; reading and editing surfaces remain opaque.
- **GitHub Copilot GPT-5.6 models** — GitHub Copilot connections now show GPT-5.6 Luna, Terra, and Sol when those models are available to the account.
- **Native iOS workspace redesign** — Refined server onboarding, added searchable and filterable session rows, introduced document-style assistant responses and richer tool activity cards, surfaced model and permission controls in the composer, improved approval safety, and made the iPad session sidebar visible by default.

## Bug Fixes

- **Reliable native saves and startup** — Task conversions wait for accepted storage before linking, note creation recovers exact receipts, and denied optional file watchers and notifications no longer produce uncaught startup errors. [#1435](https://github.com/rox-one/rox-one/pull/1435) · `d45cfc2`
- **Native user workflows** — Corrected profile ownership, own-message reactions, SDK-backed branching, private task and note persistence, scoped incoming events, session invitations and optional startup errors. Map editing preserves the camera and supports colored translucent stickers, tools, conditions and frames; same-name skills use app-owned storage and stable aliases. [#1391](https://github.com/rox-one/rox-one/pull/1391) · `ddf97e3`
- **OpenAI-compatible streams preserve chunks with empty tool-call arrays** — Custom endpoints that include `tool_calls: []` on ordinary content and terminal chunks no longer lose those chunks in the network interceptor, preventing valid responses from failing with `Stream ended without finish_reason`. Fixes [#995](https://github.com/craft-ai-agents/craft-agents-oss/issues/995).
- **Reliable iOS session loading** — Long conversations now load without hitting Foundation's 1 MB WebSocket limit, session requests wait for active reconnects, transient failures retry automatically, and manual reconnects replace stale session clients without losing unsent drafts.

## Breaking Changes

- Fixed Chinese IME first-character input conflicting with English auto-capitalisation. On some macOS/Electron builds the native `input` event fires before `compositionstart`, causing the auto-capitalise logic to capitalise the first pinyin letter and corrupt the IME composition session.

- Fixed IME composition text being invisible and placeholder hints overlaying the input during the entire composition phase. `showPlaceholder` was computed from React state (`safeValue`) which stays `''` while `onChange` is blocked during composition, making the preedit text transparent and keeping the rotating placeholder overlay visible.

- **New sessions respect excluded filters** — Creating a session while status, label, or project exclusions are active now ignores those exclusions and uses workspace defaults unless exactly one included filter is selected. [#970](https://github.com/craft-ai-agents/craft-agents-oss/issues/970) · `6a3ba29`
