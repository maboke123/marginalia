import { describe, expect, it } from 'vitest'
import { indentLines } from './indent'

const apply = (text: string, start: number, end: number, outdent = false): string => {
  const edit = indentLines(text, start, end, outdent)
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
}

describe('indentLines', () => {
  it("indents the caret's line and keeps the caret on its word", () => {
    const text = '- one\n- two\n- three'
    const edit = indentLines(text, 9, 9, false)
    expect(apply(text, 9, 9)).toBe('- one\n  - two\n- three')
    expect(edit.select).toEqual([11, 11])
  })

  it('indents every line of a selection, not the line it ends at the start of', () => {
    const text = 'a\nb\nc'
    expect(apply(text, 0, 4)).toBe('  a\n  b\nc')
    expect(indentLines(text, 0, 4, false).select).toEqual([2, 8])
  })

  it('takes away up to two spaces and never text', () => {
    expect(apply('    deep\n x\ny', 0, 13, true)).toBe('  deep\nx\ny')
    const edit = indentLines('  a', 1, 1, true)
    expect(edit.insert).toBe('a')
    expect(edit.select).toEqual([0, 0])
  })
})
