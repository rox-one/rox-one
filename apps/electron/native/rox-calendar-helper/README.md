# rox-calendar-helper

macOS EventKit bridge for the Rox Apple Calendar connector. The Electron main
process spawns this small CLI; the JS-side adapter
(`packages/core/src/calendar/apple-calendar-adapter.ts`) only speaks JSON with it.

Read-only: the helper never writes to the user's calendars.

## Build

```sh
apps/electron/native/rox-calendar-helper/build.sh            # -> ./bin/rox-calendar-helper
apps/electron/native/rox-calendar-helper/build.sh /tmp/out   # custom output dir
```

Requires the macOS SDK + `swiftc` (Command Line Tools are enough). The script
targets `macOS 13.0` for the host architecture. It embeds `Info.plist` into the
binary's `__TEXT,__info_plist` section and ad-hoc codesigns the result, so macOS
TCC can attribute the Calendars permission request. Override the signing
identity with `ROX_CALENDAR_HELPER_SIGN_IDENTITY` (defaults to `-`, ad-hoc).

## Subcommands

Exactly one line of JSON on stdout; failures exit non-zero with `{"error":"<code>"}`.

| Command | Output |
| --- | --- |
| `auth-status` | `{"status":"notDetermined\|denied\|authorized\|restricted\|limited"}` |
| `request-access` | `{"status":"<state>","granted":<bool>}` (triggers the TCC prompt) |
| `list-calendars` | `[{"id","title","color","allowsModify"}]` |
| `list-events --start <ISO> --end <ISO> [--calendar <id>]` | `[{"id","title","startAt","endAt","allDay","calendarId","hasRecurrence","notes?","location?","occurrenceOf?"}]` |

`auth-status` mapping: `.authorized`/`.fullAccess` → `authorized`, `.writeOnly` →
`limited`, everything else verbatim. `hasRecurrence` is `EKEvent.hasRecurrenceRules`.
`occurrenceOf` is currently omitted: EventKit does not expose the parent-series
identifier on expanded occurrences, so the adapter treats it as optional.

## Packaged-app integration

1. **Ship the binary.** The macOS `files` matcher already copies
   `apps/electron/resources/bin/darwin-${arch}/**/*` into the app, so place the
   built helper at `resources/bin/darwin-${arch}/rox-calendar-helper`.

2. **App Info.plist.** The packaged app also needs the calendar usage strings in
   its own Info.plist. That lives in `apps/electron/electron-builder.yml` under
   `mac.extendInfo`, which is owned by another change — it was **not** modified
   here. The required addition is:

   ```yaml
   mac:
     extendInfo:
       # ...existing keys...
       NSCalendarsUsageDescription: "Rox reads your macOS calendars to show and sync events. / Rox читает календари macOS, чтобы показывать и синхронизировать события."
       NSCalendarsFullAccessUsageDescription: "Rox needs full access to your macOS calendars to sync events. / Rox нужен полный доступ к календарям macOS для синхронизации событий."
   ```

   For per-locale strings, ship `InfoPlist.strings` in `ru.lproj`/`en.lproj`
   with the same keys instead of the inline values.

## Host wiring

The adapter is fail-closed and only becomes live when the host registers a
helper binding:

```ts
import { registerAppleCalendarHelper } from '@rox/core/calendar'

process.env.APPLE_CALENDAR_LIVE = '1' // opt-in gate
registerAppleCalendarHelper({
  hasHelper: () => existsSync(helperPath), // darwin + bundled binary present
  run: (args) => spawnHelper(helperPath, args), // { exitCode, stdout, stderr }
})
```

`helperPath` defaults to `resources/bin/darwin-${arch}/rox-calendar-helper` in a
packaged app, or the `APPLE_CALENDAR_HELPER` env override in development. Until a
binding is registered and `APPLE_CALENDAR_LIVE=1` is set, `createProductionAdapter('appleCalendar')`
returns the honest `UnavailableCalendarAdapter` and the connector chip stays disabled.