/**
 * ESLint Rule: no-hardcoded-z-index
 *
 * Single source: the v2 rule in apps/electron/eslint-rules (UI-A2, #1568). This file used to
 * be a copy of the electron rule; it now re-exports it so both packages lint stacking the same way.
 */

module.exports = require('../../../apps/electron/eslint-rules/no-hardcoded-z-index.cjs')
