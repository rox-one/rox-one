export interface PanelUrlEntry {
  route: string
  proportion: number
}

/** Versioned JSON keeps delimiters and existing URI escapes inside each route. */
export function encodePanelEntries(entries: readonly PanelUrlEntry[]): string {
  return `v2:${JSON.stringify(entries.map(({ route, proportion }) => ({ route, proportion })))}`
}

function hasTupleShape(entries: unknown): entries is Array<[unknown, unknown]> {
  return Array.isArray(entries) && entries.every(entry => Array.isArray(entry) && entry.length === 2)
}

function isTupleEntries(entries: unknown): entries is Array<[string, unknown]> {
  return hasTupleShape(entries) && entries.every(entry => typeof entry[0] === 'string' && entry[0].trim().length > 0)
}

export function decodePanelEntries(value: string): PanelUrlEntry[] {
  if (value.startsWith('v2:') || value.startsWith('json:')) {
    try {
      const compatible = value.startsWith('json:')
      const entries: unknown = JSON.parse(value.slice(value.startsWith('v2:') ? 3 : 5))
      if (!Array.isArray(entries) || !entries.every(entry =>
        entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        && typeof entry.route === 'string' && entry.route.trim().length > 0
        && (compatible || (typeof entry.proportion === 'number' && Number.isFinite(entry.proportion)
          && entry.proportion > 0 && entry.proportion <= 1)),
      )) return []
      return entries.map(({ route, proportion }) => ({ route, proportion: compatible
        && !(typeof proportion === 'number' && Number.isFinite(proportion) && proportion >= 0 && proportion <= 1)
        ? 0 : proportion }))
    } catch {
      return []
    }
  }

  // Compatibility with the unversioned tuple transport, without URI decoding.
  if (value.trimStart().startsWith('[')) {
    try {
      const entries: unknown = JSON.parse(value)
      if (hasTupleShape(entries)) {
        if (!isTupleEntries(entries)) return []
        return entries.map(([route, weight]) => ({ route, proportion:
          typeof weight === 'number' && Number.isFinite(weight) && weight > 0 && weight <= 1 ? weight : 0 }))
      }
      // Without a version marker, only the tuple structure identifies the
      // published transport. Other valid JSON spelling remains a legacy address.
    } catch {
      // A legacy unknown address can itself start with a bracket. Reserve
      // truncated tuple JSON only when its first route has the tuple string
      // syntax; plain bracket-prefixed addresses still use the CSV transport.
      const prefix = value.trimStart()
      if (prefix === '[') return []
      if (/^\[\s*\[\s*"/.test(prefix)) {
        const firstLegacyRoute = prefix.split(',')[0].replace(/:(?:\d+(?:\.\d*)?|\.\d+)$/, '')
        try {
          if (hasTupleShape(JSON.parse(firstLegacyRoute))) return []
        } catch { return [] }
      }
    }
  }

  // Keep legacy escapes verbatim: decoding `%2F` here would change route shape.
  return value.split(',').filter(entry => entry.trim().length > 0).map(entry => {
    const colonIndex = entry.lastIndexOf(':')
    if (colonIndex > 0) {
      const text = entry.slice(colonIndex + 1)
      const proportion = /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) ? Number(text) : NaN
      if (Number.isFinite(proportion) && proportion >= 0 && proportion <= 1) {
        return { route: entry.slice(0, colonIndex), proportion }
      }
    }
    return { route: entry, proportion: 0 }
  })
}
