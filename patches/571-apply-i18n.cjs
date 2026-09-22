#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'packages', 'shared', 'src', 'i18n', 'locales');
const KEYS = JSON.parse(fs.readFileSync(path.join(__dirname, '571-i18n-keys.json'), 'utf8'));
function insertAfter(lines, afterKey, newEntries) {
  const needle = '"' + afterKey + '"';
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) { idx = i; break; }
  }
  if (idx < 0) throw new Error('neighbor not found: ' + afterKey);
  const toAdd = newEntries.filter(([k]) => !lines.some((l) => l.includes('"' + k + '"')));
  if (!toAdd.length) return lines;
  const insert = toAdd.map(([k, v]) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(v) + ',');
  return [...lines.slice(0, idx + 1), ...insert, ...lines.slice(idx + 1)];
}
for (const [file, map] of Object.entries(KEYS)) {
  const fp = path.join(ROOT, file);
  let lines = fs.readFileSync(fp, 'utf8').split('\n');
  lines = insertAfter(lines, 'cloudRuns.usageTokens', Object.entries(map).filter(([k]) => k.startsWith('cloudRuns.surface.')));
  lines = insertAfter(lines, 'terminal.output', Object.entries(map).filter(([k]) => k.startsWith('terminal.surface.')));
  fs.writeFileSync(fp, lines.join('\n'));
  console.log('updated', file);
}
