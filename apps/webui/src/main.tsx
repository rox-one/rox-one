import './browser-globals'

// Evaluate shared renderer modules only after installing the browser globals,
// matching the Electron bootstrap's initialization boundary.
void import('./browser-main')
