import { describe, expect, it } from 'bun:test'
import { ids, runRoxRule } from './helpers/run-rox-rule'

const run = (code: string) => runRoxRule('no-raw-error-render', code)

describe('rox/no-raw-error-render', () => {
  it('flags raw errors rendered as JSX children', () => {
    const messages = run(`
      const a = <p>{error}</p>
      const b = <p>{err.message}</p>
      const c = <p>{e?.message}</p>
      const d = <p>{state.error}</p>
      const f = <p>{String(err)}</p>
      const g = <p>{\`Failed: \${err.message}\`}</p>
      const h = <>{loadError}</>
      const i = <p>{error ? error.message : null}</p>
    `)
    expect(ids(messages)).toEqual(Array(8).fill('rawRender'))
  })

  it('flags raw errors passed to toast helpers', () => {
    const messages = run(`
      toast.error(e.message)
      toast.error(String(err))
      toast.warning('Save failed', { description: error.message })
      toast.error(\`Could not connect: \${err}\`)
    `)
    expect(ids(messages)).toEqual(Array(4).fill('rawToast'))
  })

  it('allows presentError, conditions and non-error values', () => {
    const messages = run(`
      const a = <p>{presentError(err).title}</p>
      const b = <div>{error && <ErrorCard error={presentError(error)} />}</div>
      const c = <p>{errorCount}</p>
      const d = <p>{message.text}</p>
      const e2 = <p title={err.message}>x</p>
      toast.error(presentError(e).title)
      toast.success(String(result))
    `)
    expect(messages).toHaveLength(0)
  })
})
