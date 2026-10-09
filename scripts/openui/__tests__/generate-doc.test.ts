import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { generateDoc, OPENUI_DOC_PATH } from '../generate-doc.ts';

// Drift lock: the committed doc must equal what the generator produces today.
// Regenerate with `bun scripts/openui/generate-doc.ts` after changing the
// generator, the intro or the ROX preamble/rules.
test('committed openui.md matches generateDoc() byte for byte', () => {
  const committed = readFileSync(OPENUI_DOC_PATH, 'utf8');
  expect(committed).toBe(generateDoc());
});

test('generateDoc is deterministic and carries the ROX contract', () => {
  const doc = generateDoc();
  expect(doc).toBe(generateDoc());
  expect(doc).toContain('```openui');
  expect(doc).toContain('at most one');
  expect(doc).toContain('Query()');
  expect(doc).toContain('around 60 statements');
  expect(doc.endsWith('\n')).toBe(true);
});