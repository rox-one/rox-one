import { describe, expect, it } from 'bun:test'
import { tableToCsv } from '../table-export'

describe('tableToCsv', () => {
  it('neutralizes formula-like text while preserving numeric values and CSV quoting', () => {
    const columns = [
      { key: 'text', label: 'Text' },
      { key: 'number', label: 'Number' },
      { key: 'quoted', label: 'Quoted' },
    ]
    const rows = [{ text: ' =1+1', number: -12, quoted: '=HYPERLINK("x","y")' }]

    expect(tableToCsv(columns, rows)).toBe(
      'Text,Number,Quoted\r\n\' =1+1,-12,"\'=HYPERLINK(""x"",""y"")"',
    )
  })
})
