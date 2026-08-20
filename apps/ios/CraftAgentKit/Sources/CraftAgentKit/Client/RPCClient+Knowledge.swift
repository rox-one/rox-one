import Foundation

/// A configured Знания connection, as returned by `knowledge:listConnections`.
public struct KnowledgeConnection: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let baseUrl: String
    public let provider: String?
    public let mode: String?
    public let status: String?

    public init(
        id: String,
        baseUrl: String,
        provider: String? = nil,
        mode: String? = nil,
        status: String? = nil
    ) {
        self.id = id
        self.baseUrl = baseUrl
        self.provider = provider
        self.mode = mode
        self.status = status
    }
}

/// A node in the Знания notebook tree (`knowledge:listTree`). Recursive `children`.
public struct KnowledgeTreeNode: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let kind: String
    public let children: [KnowledgeTreeNode]?

    public init(
        id: String,
        title: String,
        kind: String,
        children: [KnowledgeTreeNode]? = nil
    ) {
        self.id = id
        self.title = title
        self.kind = kind
        self.children = children
    }
}

/// Знания engine process status (`knowledge:engineStatus`).
public struct KnowledgeEngineStatus: Codable, Equatable, Sendable {
    public let running: Bool
    public let version: String?
    public let hostingMode: String?

    public init(running: Bool, version: String? = nil, hostingMode: String? = nil) {
        self.running = running
        self.version = version
        self.hostingMode = hostingMode
    }
}

/// Read-only Знания RPC: connections, tree, engine status, and search.
extension RPCClient {
    /// `knowledge:listConnections()`.
    public func listKnowledgeConnections() async throws -> [KnowledgeConnection] {
        try await call(RPCChannels.Knowledge.listConnections)
    }

    /// `knowledge:listTree(connectionId)`.
    public func listKnowledgeTree(connectionId: String) async throws -> [KnowledgeTreeNode] {
        try await call(RPCChannels.Knowledge.listTree, args: [.string(connectionId)])
    }

    /// `knowledge:engineStatus()`.
    public func knowledgeEngineStatus() async throws -> KnowledgeEngineStatus {
        try await call(RPCChannels.Knowledge.engineStatus)
    }

    /// `knowledge:search(query)`.
    public func searchKnowledge(query: String) async throws -> JSONValue {
        try await call(RPCChannels.Knowledge.search, args: [.string(query)])
    }
}
