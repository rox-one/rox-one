import './browser-globals'
import { applyConsent } from './jam'

// Evaluate shared renderer modules only after installing the browser globals,
// matching the Electron bootstrap's initialization boundary.
void import('./browser-main')

// Load the Jam session recorder only when consent was previously granted
// (localStorage `rox.jam.enabled`). No-op when the flag is off.
applyConsent()
