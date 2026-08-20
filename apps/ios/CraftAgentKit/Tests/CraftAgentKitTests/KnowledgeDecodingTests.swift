import XCTest
@testable import CraftAgentKit

final class KnowledgeDecodingTests: XCTestCase {
    func testDecodesKnowledgeTreeNode() throws {
        let value = JSONValue.object([
            "id": .string("root"),
            "title": .string("Знания"),
            "kind": .string("notebook"),
            "children": .array([
                .object([
                    "id": .string("n1"),
                    "title": .string("Note"),
                    "kind": .string("doc"),
                ]),
            ]),
        ])
        let node: KnowledgeTreeNode = try value.decoded()
        XCTAssertEqual(node.id, "root")
        XCTAssertEqual(node.title, "Знания")
        XCTAssertEqual(node.kind, "notebook")
        XCTAssertEqual(node.children?.count, 1)
        XCTAssertEqual(node.children?.first?.id, "n1")
        XCTAssertEqual(node.children?.first?.kind, "doc")
    }

    func testDecodesKnowledgeEngineStatus() throws {
        let value = JSONValue.object([
            "running": .bool(true),
            "hostingMode": .string("h1"),
        ])
        let status: KnowledgeEngineStatus = try value.decoded()
        XCTAssertEqual(status.running, true)
        XCTAssertEqual(status.hostingMode, "h1")
        XCTAssertNil(status.version)
    }
}
