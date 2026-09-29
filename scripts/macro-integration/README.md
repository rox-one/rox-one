# Reproduce architecture artifacts

Скрипты анализируют зафиксированные source trees и генерируют план; они не запускают feature migration или production writes. Domain evidence и domain-package-amendments — reviewed source artifacts, а не автоматическая inference из directory names.

## Inputs

- Macro repository at `c966b79d40798c6c726a3b15fe90517941fc6e61`.
- ROX baseline `f63294ba4fffa7238b46b24e918925a313ad0b12`; delivery branch adds only study artifacts.
- Bun 1.4.2 used. Supply clone paths explicitly when default local path differs.

## Generator order

```sh
bun scripts/macro-integration/audit-source.mjs /ABS/MACRO /ABS/ROX
bun scripts/macro-integration/build-plan.mjs /ABS/ROX
bun scripts/macro-integration/enrich-plan.mjs /ABS/ROX
bun scripts/macro-integration/integrate-plan-amendments.mjs /ABS/ROX
bun scripts/macro-integration/build-inventory.mjs /ABS/ROX /ABS/MACRO
bun scripts/macro-integration/build-entity-map.mjs /ABS/ROX
```

`build-plan` writes seed contracts, `enrich-plan` adds typed schemas and interfaces, `integrate-plan-amendments` applies independent review and domain-specific contracts. Only the final integrated files are delivery outputs. Single generator stages do not constitute final plan validation. `audit-source` manifest edges include optional/dev/build/target dependencies; they are not runtime call graphs.

Optional primary-registry refresh (network, no credentials):

```sh
bun scripts/macro-integration/dependency-licenses.mjs /ABS/MACRO /ABS/ROX
```

All 3,330 resolved Cargo/Bun dependency records are enumerated; 13 selected exact versions have primary-registry license metadata receipts. Remaining artifacts are explicitly review-required. Metadata and enumerated locks are not release license clearance. File-scoped inventory/history/notices and exact build SBOM gates remain WP-48.

## Validator

Install isolated validation dependencies outside ROX packages:

```sh
mkdir -p /tmp/rox-architecture-validator
bun add --cwd /tmp/rox-architecture-validator mermaid@11.12.0 ajv@8.17.1 ajv-formats@3.0.1 jsdom@26.1.0
bun scripts/macro-integration/validate.mjs /ABS/ROX /ABS/MACRO /tmp/rox-architecture-validator/node_modules
```

The validator reads immutable files with `git show <baseline>:<path>`, checks required docs, code links/ranges, work-package fields, dependency graph consistency/order, entity aliases, capability treatment enum, reference resolution, Ajv JSON Schema compilation, local Markdown links, and actual Mermaid parser acceptance. Seven corrupt-artifact controls prove rejection sensitivity. Its report explicitly excludes product/runtime E2E passes.

Mermaid parsing requires a DOM for DOMPurify; jsdom provides that environment. Initial sequence syntax failures caused by semicolons were corrected in document labels. Initial attempt and diagnosis are preserved in validation-attempts.json.
