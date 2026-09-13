import XCTest
@testable import CraftAgentKit

final class ProtocolVersionPolicyTests: XCTestCase {
    func testParsesMajorFromSemver() {
        XCTAssertEqual(ProtocolVersionPolicy.major(of: "1.0"), 1)
        XCTAssertEqual(ProtocolVersionPolicy.major(of: "1.2.3"), 1)
        XCTAssertEqual(ProtocolVersionPolicy.major(of: "99.0"), 99)
    }

    func testRejectsMissingOrJunkVersions() {
        XCTAssertNil(ProtocolVersionPolicy.major(of: ""))
        XCTAssertNil(ProtocolVersionPolicy.major(of: "  "))
        XCTAssertNil(ProtocolVersionPolicy.major(of: "v1.0"))
        XCTAssertNil(ProtocolVersionPolicy.major(of: "x.y"))
    }

    func testCompatibleWhenMajorsMatch() {
        XCTAssertTrue(ProtocolVersionPolicy.isCompatible(client: "1.0", server: "1.0"))
        XCTAssertTrue(ProtocolVersionPolicy.isCompatible(client: "1.0", server: "1.9"))
        XCTAssertFalse(ProtocolVersionPolicy.isCompatible(client: "1.0", server: "2.0"))
        XCTAssertFalse(ProtocolVersionPolicy.isCompatible(client: "1.0", server: ""))
        XCTAssertFalse(ProtocolVersionPolicy.isCompatible(client: ProtocolConstants.protocolVersion, server: "99.0"))
    }

    func testRejectionMessageNamesBothSides() {
        let message = ProtocolVersionPolicy.rejectionMessage(client: "1.0", server: "2.0")
        XCTAssertTrue(message.contains("1.0"))
        XCTAssertTrue(message.contains("2.0"))
    }
}
