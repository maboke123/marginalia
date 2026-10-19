import { describe, expect, it } from 'vitest'
import { toggleMark } from './emphasis'

const apply = (text: string, from: number, to: number, mark: '**' | '*'): string => {
  const edit = toggleMark(text, from, to, mark)
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
}

describe('toggleMark', () => {
  it('wraps the selection, without the space a double-click selects after a word', () => {
    expect(apply('a Customer places', 2, 11, '**')).toBe('a **Customer** places')
    const edit = toggleMark('a Customer places', 2, 11, '*')
    expect(edit.select).toEqual([3, 11])
  })

  it('takes a mark away, around the selection or inside it', () => {
    expect(apply('a **Customer** places', 4, 12, '**')).toBe('a Customer places')
    expect(apply('a **Customer** places', 2, 14, '**')).toBe('a Customer places')
    expect(apply('an *Order*', 4, 9, '*')).toBe('an Order')
  })

  it('tells bold and italic apart', () => {
    // Italic inside bold: Ctrl+I adds italic instead of removing a star of the bold.
    expect(apply('**Order**', 2, 7, '*')).toBe('***Order***')
    expect(apply('***Order***', 3, 8, '**')).toBe('*Order*')
    expect(apply('***Order***', 3, 8, '*')).toBe('**Order**')
  })

  it('puts the caret between new marks when nothing is selected', () => {
    const edit = toggleMark('total', 5, 5, '**')
    expect(edit.insert).toBe('****')
    expect(edit.select).toEqual([7, 7])
  })
})
