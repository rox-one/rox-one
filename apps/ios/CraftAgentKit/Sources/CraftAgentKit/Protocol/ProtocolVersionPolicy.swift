import Foundation

/// Client-side protocol major-version policy.
/// Mirrors `packages/server-core/src/transport/server.ts` handshake check:
/// missing version or a different major is rejected. Minor/patch may differ.
public enum ProtocolVersionPolicy {
    public static func major(of version: String) -> Int? {
        let trimmed = version.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let head = trimmed.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false).first
        guard let head, let value = Int(head) else { return nil }
        return value
    }

    public static func isCompatible(client: String, server: String) -> Bool {
        guard let clientMajor = major(of: client), let serverMajor = major(of: server) else {
            return false
        }
        return clientMajor == serverMajor
    }

    public static func rejectionMessage(client: String, server: String) -> String {
        "Server protocol \(server.isEmpty ? "missing" : server), client \(client)"
    }
}
