import { describe, expect, it } from 'bun:test'
import type { A2uiMessage } from '../a2ui.ts'
import { A2UI_V09_VERSION, A2uiValidationError, validateA2uiJsonl } from '../a2ui.ts'

const BASIC_CATALOG = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'

const V08_MESSAGES: A2uiMessage[] = [
  {
    surfaceUpdate: {
      surfaceId: 'main',
      components: [{ id: 'root', component: { Text: { text: { literalString: 'hello' } } } }],
    },
  },
  {
    dataModelUpdate: {
      surfaceId: 'main',
      path: '/status',
      contents: [{ key: 'state', valueString: 'ready' }],
    },
  },
  { beginRendering: { surfaceId: 'main', root: 'root' } },
  { deleteSurface: { surfaceId: 'main' } },
]

const V09_CREATE_SURFACE: A2uiMessage = {
  version: A2UI_V09_VERSION,
  createSurface: { surfaceId: 'main', catalogId: BASIC_CATALOG },
}

const V09_DELETE_SURFACE: A2uiMessage = {
  version: A2UI_V09_VERSION,
  deleteSurface: { surfaceId: 'main' },
}

const V09_MESSAGES: A2uiMessage[] = [
  V09_CREATE_SURFACE,
  {
    version: A2UI_V09_VERSION,
    updateComponents: {
      surfaceId: 'main',
      components: [{ id: 'root', component: 'Text', text: 'hello' }],
    },
  },
  { version: A2UI_V09_VERSION, updateDataModel: { surfaceId: 'main', path: '/status', value: 'ready' } },
  V09_DELETE_SURFACE,
]

function jsonl(...messages: unknown[]): string {
  return messages.map((message) => JSON.stringify(message)).join('\n')
}

function expectIssues(source: string, pattern: RegExp): void {
  try {
    validateA2uiJsonl(source)
  } catch (error) {
    expect(error).toBeInstanceOf(A2uiValidationError)
    const validationError = error as A2uiValidationError
    expect(validationError.message).toMatch(pattern)
    expect(validationError.issues.length).toBeGreaterThan(0)
    return
  }
  throw new Error(`expected validation to fail: ${source}`)
}

describe('validateA2uiJsonl — v0.8 (unversioned)', () => {
  it.each(V08_MESSAGES)('accepts %j', (message) => {
    expect(validateA2uiJsonl(jsonl(message))).toEqual({
      version: '0.8',
      messageCount: 1,
      messages: [message],
    })
  })

  it('accepts the full v0.8 action set in one document', () => {
    expect(validateA2uiJsonl(jsonl(...V08_MESSAGES))).toEqual({
      version: '0.8',
      messageCount: 4,
      messages: V08_MESSAGES,
    })
  })

  it('rejects an explicit 0.8 version', () => {
    expectIssues(
      jsonl({ version: '0.8', beginRendering: { surfaceId: 'main', root: 'root' } }),
      /must not carry a version field/,
    )
  })

  it('rejects the upstream v0.8 spelling', () => {
    expectIssues(
      jsonl({ version: 'v0.8', deleteSurface: { surfaceId: 'main' } }),
      /must not carry a version field/,
    )
  })
})

describe('validateA2uiJsonl — v0.9 (versioned)', () => {
  it.each(V09_MESSAGES)('accepts %j', (message) => {
    expect(validateA2uiJsonl(jsonl(message))).toEqual({
      version: '0.9',
      messageCount: 1,
      messages: [message],
    })
  })

  it('accepts the full v0.9 action set in one document', () => {
    expect(validateA2uiJsonl(jsonl(...V09_MESSAGES))).toEqual({
      version: '0.9',
      messageCount: 4,
      messages: V09_MESSAGES,
    })
  })
})

describe('validateA2uiJsonl — version rules', () => {
  it('rejects an unknown version', () => {
    expectIssues(
      jsonl({ version: '1.0', deleteSurface: { surfaceId: 'main' } }),
      /unsupported A2UI version "1\.0"/,
    )
  })

  it('rejects the upstream v0.9 spelling (the ROX literal is the bare 0.9)', () => {
    expectIssues(
      jsonl({ version: 'v0.9', deleteSurface: { surfaceId: 'main' } }),
      /unsupported A2UI version "v0\.9"/,
    )
  })

  it('rejects a v0.8 action key carrying a v0.9 version', () => {
    expectIssues(
      jsonl({ version: '0.9', surfaceUpdate: { surfaceId: 'main', components: [] } }),
      /exactly one v0\.9 action key/,
    )
  })

  it('rejects an unversioned v0.9 action key', () => {
    expectIssues(
      jsonl({ createSurface: { surfaceId: 'main', catalogId: BASIC_CATALOG } }),
      /exactly one v0\.8 action key/,
    )
  })

  it('rejects a line carrying two action keys', () => {
    expectIssues(
      jsonl({
        version: '0.9',
        createSurface: { surfaceId: 'main', catalogId: BASIC_CATALOG },
        deleteSurface: { surfaceId: 'main' },
      }),
      /exactly one v0\.9 action key, found 2/,
    )
  })

  it('rejects mixed v0.8 and v0.9 messages in one document', () => {
    expectIssues(
      jsonl(
        { deleteSurface: { surfaceId: 'legacy' } },
        { version: '0.9', deleteSurface: { surfaceId: 'modern' } },
      ),
      /mixed A2UI v0\.8 and v0\.9 messages in one document/,
    )
  })
})

describe('validateA2uiJsonl — document shape', () => {
  it('rejects an empty document', () => {
    expectIssues('', /no A2UI JSONL messages found/)
    expectIssues(' \n\t\r\n ', /no A2UI JSONL messages found/)
  })

  it('accepts CRLF line endings', () => {
    const source = jsonl(...V09_MESSAGES).replace(/\n/g, '\r\n')
    expect(validateA2uiJsonl(source)).toEqual({
      version: '0.9',
      messageCount: 4,
      messages: V09_MESSAGES,
    })
  })

  it('accepts a leading byte-order mark', () => {
    expect(validateA2uiJsonl(`\uFEFF${jsonl(V09_CREATE_SURFACE)}`)).toEqual({
      version: '0.9',
      messageCount: 1,
      messages: [V09_CREATE_SURFACE],
    })
  })

  it('ignores blank lines and counts only messages', () => {
    const source = ['', `  ${jsonl(V09_DELETE_SURFACE)}  `, '', ''].join('\r\n')
    expect(validateA2uiJsonl(source)).toEqual({
      version: '0.9',
      messageCount: 1,
      messages: [V09_DELETE_SURFACE],
    })
  })

  it('rejects non-string input', () => {
    expect(() => (validateA2uiJsonl as (value: unknown) => unknown)(null)).toThrow(/must be a string/)
  })

  it('reports every problem in one error', () => {
    try {
      validateA2uiJsonl(`{not json}\n${jsonl({ version: '9.9', deleteSurface: { surfaceId: 'main' } })}`)
      throw new Error('expected validation to fail')
    } catch (error) {
      const validationError = error as A2uiValidationError
      expect(validationError).toBeInstanceOf(A2uiValidationError)
      expect(validationError.name).toBe('A2uiValidationError')
      expect(validationError.issues.length).toBe(2)
      expect(validationError.issues[0]).toMatch(/^line 1: /)
      expect(validationError.issues[1]).toMatch(/^line 2: /)
      expect(validationError.message.startsWith('Invalid A2UI JSONL:\n- line 1: ')).toBe(true)
    }
  })
})

describe('validateA2uiJsonl — structural strictness', () => {
  it('rejects an unexpected top-level field', () => {
    expectIssues(
      jsonl({ deleteSurface: { surfaceId: 'main' }, extra: true }),
      /unexpected field "extra"/,
    )
  })

  it('rejects an unexpected v0.9 top-level field beside the version', () => {
    expectIssues(
      jsonl({ version: '0.9', deleteSurface: { surfaceId: 'main' }, actionTier: 'prompt' }),
      /unexpected field "actionTier"/,
    )
  })

  it('rejects an unexpected payload field', () => {
    expectIssues(
      jsonl({ version: '0.9', deleteSurface: { surfaceId: 'main', extra: 1 } }),
      /unexpected field "extra"/,
    )
  })

  it('rejects a non-object line', () => {
    expectIssues('[1]', /expected a JSON object/)
    expectIssues('null', /expected a JSON object/)
  })

  it('rejects invalid JSON with its line number', () => {
    expectIssues('{', /^Invalid A2UI JSONL:\n- line 1: /)
  })

  it('rejects a non-object payload', () => {
    expectIssues(jsonl({ version: '0.9', deleteSurface: [] }), /payload must be a JSON object/)
  })

  it('rejects a missing or empty surfaceId', () => {
    expectIssues(jsonl({ version: '0.9', createSurface: { catalogId: BASIC_CATALOG } }), /surfaceId/)
    expectIssues(
      jsonl({ version: '0.9', createSurface: { surfaceId: '', catalogId: BASIC_CATALOG } }),
      /surfaceId/,
    )
  })

  it('rejects malformed kind-specific payloads', () => {
    expectIssues(jsonl({ beginRendering: { surfaceId: 'main' } }), /requires a non-empty string root/)
    expectIssues(
      jsonl({ version: '0.9', createSurface: { surfaceId: 'main' } }),
      /requires a non-empty string catalogId/,
    )
    expectIssues(
      jsonl({ surfaceUpdate: { surfaceId: 'main', components: 'root' } }),
      /requires an array components/,
    )
    expectIssues(
      jsonl({ surfaceUpdate: { surfaceId: 'main', components: [{ id: 'root', component: 'Text' }] } }),
      /requires an object component/,
    )
    expectIssues(
      jsonl({
        version: '0.9',
        updateComponents: { surfaceId: 'main', components: [{ id: 'root', component: { Text: {} } }] },
      }),
      /requires a non-empty string component/,
    )
    expectIssues(
      jsonl({ dataModelUpdate: { surfaceId: 'main', path: '/status' } }),
      /requires contents or value/,
    )
    expectIssues(
      jsonl({ version: '0.9', updateDataModel: { surfaceId: 'main', value: 'ready' } }),
      /requires a non-empty string path/,
    )
    expectIssues(
      jsonl({ version: '0.9', updateDataModel: { surfaceId: 'main', path: '/status' } }),
      /requires value/,
    )
  })

  it('accepts a v0.8 data model update that carries a whole value', () => {
    expect(validateA2uiJsonl(jsonl({ dataModelUpdate: { surfaceId: 'main', value: { a: 1 } } }))).toEqual({
      version: '0.8',
      messageCount: 1,
      messages: [{ dataModelUpdate: { surfaceId: 'main', value: { a: 1 } } }],
    })
  })
})

describe('validateA2uiJsonl — embedded script payloads', () => {
  it('rejects a raw </script> sequence', () => {
    expectIssues(
      jsonl({
        version: '0.9',
        updateDataModel: { surfaceId: 'main', path: '/html', value: '</script><img src=x>' },
      }),
      /raw <\/script> sequence in A2UI source/,
    )
  })

  it('rejects a raw </SCRIPT> sequence regardless of case', () => {
    expectIssues(
      jsonl({ surfaceUpdate: { surfaceId: 'main', components: [{ id: 'a', component: { Text: '</SCRIPT>' } }] } }),
      /raw <\/script> sequence/,
    )
  })

  it('accepts an escaped <\\/script> sequence', () => {
    const source =
      '{"version":"0.9","updateDataModel":{"surfaceId":"main","path":"/html","value":"<\\/script>"}}'
    expect(validateA2uiJsonl(source)).toEqual({
      version: '0.9',
      messageCount: 1,
      messages: [
        { version: '0.9', updateDataModel: { surfaceId: 'main', path: '/html', value: '</script>' } },
      ],
    })
  })
})