# Web UI Jam (jam.dev) session recorder — consent-gated loader

Date: 2026-10-09

## What

`apps/webui/src/jam.ts` loads the Jam session recorder in the web UI, gated on
explicit consent. It mirrors the marketing-site snippet
(`apps/marketing` layout): a `<meta name="jam:team">` tag plus the official
module scripts.

- Team id source: `apps/marketing/src/app/layout.tsx`
  (`<meta name="jam:team" content="52d8f20d-e8dc-4e05-850a-695cf744701e" />`).
- Scripts: `https://js.jam.dev/recorder.js`, `https://js.jam.dev/capture.js`.

## Consent model

The web UI has no shared consent store yet, so consent is a persisted local
flag:

- `localStorage['rox.jam.enabled'] === '1'` — consent granted.

Nothing (meta tag, recorder, capture script, cookies) is loaded while the flag
is off. The team id is supplied at build time via `VITE_JAM_TEAM` (public, safe
to embed); when unset, Jam never loads even with consent.

## API

- `applyConsent()` — boot hook called from `main.tsx`; loads the recorder only
  when consent was previously granted.
- `enable()` / `disable()` — grant/revoke consent (settings-toggle entry points).
  Revoking clears the flag and removes injected tags; an already-running
  recorder stops only after a reload.
- `isEnabled()` / `isConsented()` / `isInjected()` / `jamTeamId()` — inspection.

## Wiring

`apps/webui/src/main.tsx` calls `applyConsent()` after the browser-globals
bootstrap. Unit coverage: `apps/webui/src/__tests__/jam.test.ts` (DOM stub).