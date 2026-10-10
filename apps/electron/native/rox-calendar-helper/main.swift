// rox-calendar-helper — macOS EventKit bridge for Rox Apple Calendar integration.
//
// A tiny CLI the Electron main process spawns. Every subcommand writes exactly
// one length-prefixed JSON frame to stdout — a 4-byte big-endian payload length
// followed by the UTF-8 JSON bytes — and exits non-zero with {"error":"<code>"}
// on failure. The frame matches `@rox/shared/local-ipc/framing`.
//
//   auth-status                                  -> {"status":"<state>"}
//   request-access                               -> {"status":"<state>","granted":<bool>}
//   list-calendars                               -> [{"id","title","color","allowsModify"}]
//   list-events --start <ISO> --end <ISO> [--calendar <id>]
//                                                -> [{"id","title","startAt","endAt",
//                                                     "allDay","calendarId","hasRecurrence",
//                                                     "notes?","location?","occurrenceOf?"}]
//
// Read-only: this helper never writes to the user's calendars.

import EventKit
import Foundation

// MARK: - Output

func writeFrame(_ payload: Data) {
    var header = UInt32(payload.count).bigEndian
    let headerData = withUnsafeBytes(of: &header) { Data($0) }
    FileHandle.standardOutput.write(headerData)
    FileHandle.standardOutput.write(payload)
}

func emit(_ value: Any) {
    guard JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else {
        FileHandle.standardError.write(Data("{\"error\":\"encode-failed\"}\n".utf8))
        exit(1)
    }
    writeFrame(data)
}

func fail(_ code: String) -> Never {
    emit(["error": code])
    exit(1)
}

// MARK: - Dates

let isoFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
}()

func parseISODate(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: value) { return date }
    return isoFormatter.date(from: value)
}

// MARK: - Authorization

func statusString(_ status: EKAuthorizationStatus) -> String {
    switch status {
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .authorized: return "authorized"
    @unknown default:
        // macOS 14+ introduces .fullAccess (rawValue 3) and macOS 17+ .writeOnly (rawValue 4).
        switch status.rawValue {
        case 3: return "authorized"
        case 4: return "limited"
        default: return "notDetermined"
        }
    }
}

func requestAccess(_ store: EKEventStore) {
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    let complete: (Bool, Error?) -> Void = { ok, _ in
        granted = ok
        semaphore.signal()
    }
    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents(completion: complete)
    } else {
        store.requestAccess(to: .event, completion: complete)
    }
    semaphore.wait()
    emit(["status": statusString(EKEventStore.authorizationStatus(for: .event)), "granted": granted])
}

// MARK: - Calendars

func hexColor(_ color: CGColor?) -> String {
    guard let components = color?.components, let first = components.first else { return "" }
    let red = components.count >= 3 ? components[0] : first
    let green = components.count >= 3 ? components[1] : first
    let blue = components.count >= 3 ? components[2] : first
    let channel = { (value: CGFloat) -> Int in Int((max(0, min(1, value)) * 255).rounded()) }
    return String(format: "#%02X%02X%02X", channel(red), channel(green), channel(blue))
}

func listCalendars(_ store: EKEventStore) {
    let rows: [[String: Any]] = store.calendars(for: .event).map { calendar in
        [
            "id": calendar.calendarIdentifier,
            "title": calendar.title,
            "color": hexColor(calendar.cgColor),
            "allowsModify": calendar.allowsContentModifications,
        ]
    }
    emit(rows)
}

// MARK: - Events

func option(_ name: String, in args: [String]) -> String? {
    guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
    return args[index + 1]
}

func listEvents(_ store: EKEventStore, args: [String]) {
    guard let startValue = option("--start", in: args), let start = parseISODate(startValue) else {
        fail("bad-start")
    }
    guard let endValue = option("--end", in: args), let end = parseISODate(endValue) else {
        fail("bad-end")
    }

    var calendars: [EKCalendar]? = nil
    if let calendarId = option("--calendar", in: args) {
        let matches = store.calendars(for: .event).filter { $0.calendarIdentifier == calendarId }
        if matches.isEmpty { fail("calendar-not-found") }
        calendars = matches
    }

    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
    let rows: [[String: Any]] = store.events(matching: predicate).map { event in
        let calendarId = event.calendar?.calendarIdentifier ?? ""
        // Expanded occurrences of a recurring series have no eventIdentifier; fall back
        // to a deterministic calendar+instant key so sync ids stay stable within a run.
        let identifier = event.eventIdentifier ?? "\(calendarId)#\(Int(event.startDate.timeIntervalSince1970))"
        var row: [String: Any] = [
            "id": identifier,
            "title": event.title ?? "",
            "startAt": isoFormatter.string(from: event.startDate),
            "endAt": isoFormatter.string(from: event.endDate),
            "allDay": event.isAllDay,
            "calendarId": calendarId,
            "hasRecurrence": event.hasRecurrenceRules,
        ]
        if let notes = event.notes, !notes.isEmpty { row["notes"] = notes }
        if let location = event.location, !location.isEmpty { row["location"] = location }
        return row
    }
    emit(rows)
}

// MARK: - Entry point

let arguments = Array(CommandLine.arguments.dropFirst())
guard let command = arguments.first else { fail("missing-command") }

let store = EKEventStore()
switch command {
case "auth-status":
    emit(["status": statusString(EKEventStore.authorizationStatus(for: .event))])
case "request-access":
    requestAccess(store)
case "list-calendars":
    listCalendars(store)
case "list-events":
    listEvents(store, args: arguments)
default:
    fail("unknown-command")
}