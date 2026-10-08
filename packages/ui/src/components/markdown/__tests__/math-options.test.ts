import { describe, it, expect } from 'bun:test'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMath from 'remark-math'
import { MARKDOWN_MATH_OPTIONS, markdownMayContainMath } from '../math-options'

type MdNode = {
  type: string
  value?: string
  children?: MdNode[]
}

function parseMarkdown(input: string): MdNode {
  const processor = unified().use(remarkParse).use(remarkMath, MARKDOWN_MATH_OPTIONS)
  return processor.runSync(processor.parse(input)) as MdNode
}

function collectInlineMathValues(node: MdNode): string[] {
  const values: string[] = []
  const walk = (current: MdNode) => {
    if (current.type === 'inlineMath' && typeof current.value === 'string') {
      values.push(current.value)
    }
    for (const child of current.children ?? []) {
      walk(child)
    }
  }
  walk(node)
  return values
}

describe('MARKDOWN_MATH_OPTIONS', () => {
  it('does not treat currency-like single-dollar text as inline math', () => {
    const tree = parseMarkdown('**$2M–$4M ARR/employee**')
    expect(collectInlineMathValues(tree)).toEqual([])
  })

  it('still supports explicit $$ math delimiters', () => {
    const tree = parseMarkdown('The formula is $$E=mc^2$$.')
    expect(collectInlineMathValues(tree)).toEqual(['E=mc^2'])
  })
})

describe('markdownMayContainMath', () => {
  it('detects $$ display math', () => {
    expect(markdownMayContainMath('Energy: $$E = mc^2$$')).toBe(true)
  })

  it('detects ```math and ~~~math fences without $$', () => {
    expect(markdownMayContainMath('Intro\n\n```math\nx^2\n```\n')).toBe(true)
    expect(markdownMayContainMath('```  math\nx^2\n```')).toBe(true)
    expect(markdownMayContainMath('~~~math\nx^2\n~~~')).toBe(true)
  })

  it('ignores currency, other fences and lookalike languages', () => {
    expect(markdownMayContainMath('It costs $100 to $200.')).toBe(false)
    expect(markdownMayContainMath('```ts\nconst math = 1\n```')).toBe(false)
    expect(markdownMayContainMath('```mathematica\nx\n```')).toBe(false)
  })
})
