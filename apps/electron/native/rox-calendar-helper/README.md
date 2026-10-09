# rox-calendar-helper

macOS EventKit bridge for the Rox Apple Calendar connector. The Electron main
process spawns this small CLI; the JS-side adapter
(`packages/core/src/calendar/apple-calendar-adapter.ts`) only speaks JSON with it.

Read-only: the helper never writes to the user's calendars.

## Build

```sh
# host arch -> apps/electron/native/rox-calendar-helper/bin/rox-calendar-helper
#           -> apps/electron/resources/bin/darwin-$(node -p process.arch)/rox-calendar-helper
bun run build:native:calendar

# Intel slice (cross-compiles on Apple Silicon; separate output dir)
bun run build:native:calendar:x64
```

Both scripts run `native/rox-calendar-helper/build.sh`. The first is what serves
the **dev path** the host resolver looks at
(`apps/electron/native/rox-calendar-helper/bin/rox-calendar-helper`); the copy it
makes under `resources/bin/darwin-<arch>/` is the **packaging input** (see below).

Raw script usage:

```sh
apps/electron/native/rox-calendar-helper/build.sh            # -> ./bin/rox-calendar-helper
apps/electron/native/rox-calendar-helper/build.sh /tmp/out   # custom output dir
```

Requires the macOS SDK + `swiftc` (Command Line Tools are enough). The script
targets `macOS 13.0` for the host architecture (`ROX_CALENDAR_HELPER_TARGET`
overrides the triple). It embeds `Info.plist` into the binary's
`__TEXT,__info_plist` section and ad-hoc codesigns the result, so macOS TCC can
attribute the Calendars permission request. Override the signing identity with
`ROX_CALENDAR_HELPER_SIGN_IDENTITY` (defaults to `-`, ad-hoc).

`bin/` output is a build artifact — do not commit it. The staged
`apps/electron/resources/bin/darwin-arm64/` and `darwin-x64/` directories are
already gitignored (they hold other platform binaries too).

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

## Path resolution

`apps/electron/src/main/calendar/register-helper.ts` resolves the binary:

| Mode | Path |
| --- | --- |
| development | `<appPath>/native/rox-calendar-helper/bin/rox-calendar-helper` |
| packaged (macOS) | `<process.resourcesPath>/bin/darwin-<arch>/rox-calendar-helper` |
| any (override) | `APPLE_CALENDAR_HELPER` env var |

`<arch>` is Electron's arch name (`arm64` / `x64`). Non-darwin platforms resolve
to `null`.

## Packaging

`electron-builder.yml` copies the staged binary outside the ASAR:

```yaml
mac:
  extraResources:
    - from: resources/bin/darwin-${arch}/rox-calendar-helper
      to: bin/darwin-${arch}/rox-calendar-helper
```

`resources/bin/darwin-<arch>/` is also matched by the mac `files` glob, so the
binary additionally ends up under `Contents/Resources/app/resources/bin/…`; the
runtime resolver uses the `extraResources` copy at
`Contents/Resources/bin/darwin-<arch>/rox-calendar-helper`, because helpers must
be a real file outside the app bundle's internal resource tree.

`${arch}` expands to the build target arch, so only the matching slice is copied.
If the slice was not staged, electron-builder logs `file source doesn't exist`
and the app ships without the helper — the connector then stays Unavailable. It
never bundles a foreign-architecture binary.

Wiring in `apps/electron/package.json`:
`dist:mac` runs `build:native:calendar` (host arch = arm64 on Apple Silicon) and
`dist:mac:x64` runs `build:native:calendar:x64` before `scripts/build-dmg.sh`.

> **Not wired (owned by other changes):** the repo-root `electron:dist:mac*`
> scripts and `apps/electron/scripts/build-dmg.sh` are the entry points used by
> release builds. They must run `bun run build:native:calendar` (and
> `build:native:calendar:x64` for an x64/universal artifact) from
> `apps/electron/` before `electron-builder`, otherwise the helper is skipped
> with only the warning above. This change does not modify those files.

## Permissions (TCC)

The helper's own `Info.plist` is embedded in the binary, and the **packaged app**
must also carry the Calendars usage strings or macOS silently denies the
authorization request. Both are set in `electron-builder.yml` under
`mac.extendInfo` (RU+EN, matching `Info.plist`):

- `NSCalendarsUsageDescription` — read calendars to show/sync events
- `NSCalendarsFullAccessUsageDescription` — full access needed to sync events

For per-locale strings ship `InfoPlist.strings` in `ru.lproj`/`en.lproj` with the
same keys instead of the inline values.

`auth-status` never prompts. The TCC prompt is only raised by `request-access`
(and by EventKit the first time a query is attempted without authorization).

## Host wiring

`apps/electron/src/main/index.ts` calls
`registerAppleCalendarHelperFromHost(...)` after the calendar OAuth IPC is
registered. It registers the binding **only** when
`APPLE_CALENDAR_LIVE=1` (`appleCalendarLiveEnabled`) *and* the resolved binary
exists; otherwise it registers nothing and the adapter keeps returning the
honest `UnavailableCalendarAdapter`. A missing binary, unsupported platform, or
spawn failure never crashes the app.

The binding exposes `hasHelper()` (synchronous existence check) and `run(args)`
(spawns the CLI, returns `{ exitCode, stdout, stderr }`). The probe
`probeAppleCalendarHelperAuthStatus(helperPath)` reads `auth-status` for host
surfaces and returns `null` when the helper is unreachable.

Until a binding is registered and `APPLE_CALENDAR_LIVE=1` is set,
`createProductionAdapter('appleCalendar')` returns `UnavailableCalendarAdapter`
and the connector chip stays disabled.