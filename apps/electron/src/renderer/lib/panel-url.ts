export interface PanelUrlEntry {
  route: string
  proportion: number
}

/** Versioned JSON keeps delimiters and existing URI escapes inside each route. */
export function encodePanelEntries(entries: readonly PanelUrlEntry[]): string {
  return `v2:${JSON.stringify(entries.map(({ route, proportion }) => ({ route, proportion })))}`
}

export function decodePanelEntries(value: string): PanelUrlEntry[] {
  if (value.startsWith('v2:')) {
    try {
      const entries: unknown = JSON.parse(value.slice(3))
      if (!Array.isArray(entries) || !entries.every(entry =>
        entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        && typeof entry.route === 'string' && entry.route.length > 0
        && typeof entry.proportion === 'number' && Number.isFinite(entry.proportion)
        && entry.proportion > 0 && entry.proportion <= 1,
      )) return []
      return entries.map(({ route, proportion }) => ({ route, proportion }))
    } catch {
      return []
    }
  }

  // Keep legacy escapes verbatim: decoding `%2F` here would change route shape.
  return value.split(',').filter(Boolean).map(entry => {
    const colonIndex = entry.lastIndexOf(':')
    if (colonIndex > 0) {
      const text = entry.slice(colonIndex + 1)
      const proportion = /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) ? Number(text) : NaN
      if (!isNaN(proportion) && proportion > 0 && proportion < 1) {
        return { route: entry.slice(0, colonIndex), proportion }
      }
    }
    return { route: entry, proportion: 0 }
  })
}
