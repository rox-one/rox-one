// Test-only entry point: production code imports persistence/index or analytics/index.
import * as persistence from './index'
import * as analytics from '../analytics'
Object.assign(globalThis, { learningTest: { ...persistence, ...analytics } })
