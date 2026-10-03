# OMP exit and stdio drain repair

Owner: `patch_scout`; independent source review: `spec_review`; integration and GitHub delivery: root.

The OMP child can emit `exit` before the parent has consumed its final stdout and stderr. The adapter previously finished its chunk decoder and cleared current-child ownership at `exit`. Buffered complete responses and final turn completion could then be discarded. A buffered first chunk could also produce a generic exit error instead of the exact protocol truncation error.

The adapter must retain the child's stdout/readline and stderr ownership until its `close` event. At that boundary it finishes the actual decoder before resetting or detaching the child. Pre-ready startup classification must settle immediately at that same boundary, retaining the signature latch and captured startup-generation/reject fence. A second listener installed after `close` must not be required to settle startup.

An inherited open pipe must remain bounded by the existing 250 ms exit fallback. This deadline permits failure finalization and closes the captured reader; it does not assert that an inherited pipe reached EOF. A predecessor's close or fallback may clean its own reader, but may not finish or reset a successor's decoder. Independent per-attempt runtime/profile/overlay disposal still follows the child's actual close. Protocol failures retain their exact error, terminate the affected child, and complete one terminal event stream.

Acceptance uses the actual production registration callbacks, actual OmpAgent terminal/startup handlers, actual protocol codec and actual readline streams. The controlled child event source can hold bytes across `exit`, then release them before `close`; only the fallback clock is manually controlled. Cases cover a complete large response, a late first chunk and exact truncation, a final successful line without newline, late stderr signature and eviction latch, stale predecessor isolation, inherited pipe fallback and reader release, and clean successor recovery. No executable or provider is involved in these deterministic cases.

Existing fake-process transport, flow, startup, query and permissions assertions remain applicable. The original transport/model/payload assertions and internal eight-second chat guards are retained. The optional 30-second Bun case allowance covers process setup and cleanup; it does not change an internal chat or protocol bound. Every process run uses Bun 1.3.14 and Node 24.21.0 plus a nonexistent ambient `OMP_CLI_PATH` to prevent installed CLI fallback.

This is a bounded source/runtime repair. It does not establish installed Windows/macOS, signed application, live provider, deployment or full UI-001 acceptance.
