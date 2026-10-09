/**
 * Cross-platform asset copy script.
 *
 * Copies the resources/ directory to dist/resources/, omitting unread
 * session-mcp-server / bridge-mcp-server trees (ticket 10).
 * All bundled assets (docs, themes, permissions, tool-icons) now live in resources/
 * which electron-builder handles natively via directories.buildResources.
 *
 * At Electron startup, setBundledAssetsRoot(__dirname) is called, and then
 * getBundledAssetsDir('docs') resolves to <__dirname>/resources/docs/, etc.
 *
 * Run: bun scripts/copy-assets.ts
 */

import { copyFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { copyElectronResourceTree } from '../../../scripts/build/staged-servers.ts';

copyElectronResourceTree('resources', 'dist/resources');

console.log('✓ Copied resources/ → dist/resources/ (skipped unread session/bridge MCP servers)');

// Copy PowerShell parser script (for Windows command validation in Explore mode)
// Source: packages/shared/src/agent/powershell-parser.ps1
// Destination: dist/resources/powershell-parser.ps1
const psParserSrc = join('..', '..', 'packages', 'shared', 'src', 'agent', 'powershell-parser.ps1');
const psParserDest = join('dist', 'resources', 'powershell-parser.ps1');
try {
  copyFileSync(psParserSrc, psParserDest);
  console.log('✓ Copied powershell-parser.ps1 → dist/resources/');
} catch (err) {
  // Only warn - PowerShell validation is optional on non-Windows platforms
  console.log('⚠ powershell-parser.ps1 copy skipped (not critical on non-Windows)');
}

// Copy the Browser Intelligence DB schema. The packaged main process and the
// unfurl Worker Thread open the intelligence database and load the DDL from the
// packaged resources.
// Source: packages/browser-intel/src/db/schema.sql
// Destination: dist/resources/browser-intel/schema.sql
const intelSchemaSrc = join('..', '..', 'packages', 'browser-intel', 'src', 'db', 'schema.sql');
const intelSchemaDir = join('dist', 'resources', 'browser-intel');
try {
  mkdirSync(intelSchemaDir, { recursive: true });
  copyFileSync(intelSchemaSrc, join(intelSchemaDir, 'schema.sql'));
  console.log('✓ Copied schema.sql → dist/resources/browser-intel/');
} catch (err) {
  // Only warn - the schema is only required once the pipeline opens the database.
  console.log('⚠ browser-intel schema.sql copy skipped (pipeline DB unavailable)');
}
