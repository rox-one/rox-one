# Revision-bound validation

Base: `4413e4ae352a6844b498b31f239ffc6c3676d7a7`.

Hook before SHA-256: `13543daf34873c044fb089504e6d6146878cdb327b6e94d6a43f776ecd243d31`.

Hook after SHA-256: `2b87d14b619e470a531e82f5e10f94af0fd916dee1e8abcbfdfb64590f0186ac`.

## Actual gates

| Gate | Result | Boundary |
|---|---|---|
| Before hook + actual union catalog wrapper, same14 cases |2pass/12fail/22assertions, exit1| Expected race/scope/disposal negatives; source baseline matched |
| Corrected hook + actual union catalog wrapper |14pass/0fail/31assertions, exit0| Actual closures and real Jotai; synthetic DTO/IPC fixtures |
| Independent root source review and original13-case rerun |13pass/0fail/29assertions, exit0| Same corrected source; no concrete findings |
| Earlier consumed-contract closure types |exit0| Exact copied DTO/atom and two IPC signatures; full renderer types unrun |
| Whitespace check |exit0| source bytes unchanged after gates |

Runtime: Bun1.3.14. Command: `bun test apps/electron/src/renderer/hooks/__tests__/useProjects-scope.test.ts`.

The added14th case verifies actual projectCatalogAtom shared metadata retention; the original13 regression assertion bodies are retained. Sanitized logs and exact hashes are in evidence/ and validation.json. Personal filesystem prefixes in the RED stack are replaced with fixture/; private raw logs remain separate provenance artifacts.

This controlled closure/lifecycle evidence does not claim a DOM mount, native/browser pass, authority acceptance, full repository suite or completion of the R15 union. Existing source owners retain integration, full build/type/native/UI gates and program acceptance.
