import { describe, expect, it } from 'vitest'
import { cellAt, cellStart, formatTable, isSeparator, splitRow } from './tables'

describe('tables', () => {
  it('splits rows and keeps escaped pipes', () => {
    expect(splitRow('| a | b \\| c |')).toEqual(['a', 'b \\| c'])
    expect(splitRow('a|b')).toEqual(['a', 'b'])
  })

  it('recognises the separator row', () => {
    expect(isSeparator('| --- | :-: |')).toBe(true)
    expect(isSeparator('| a | b |')).toBe(false)
  })

  it('pads every column and keeps alignment', () => {
    expect(
      formatTable(['| Split | Gain |', '|---|--:|', '| Outlook | 0.246 |', '| Wind | 0.048 |'])
    ).toEqual([
      '| Split   |  Gain |',
      '| ------- | ----: |',
      '| Outlook | 0.246 |',
      '| Wind    | 0.048 |'
    ])
  })

  it('adds missing cells to short rows', () => {
    expect(formatTable(['| a | b |', '| - | - |', '| c |'])).toEqual([
      '| a   | b   |',
      '| --- | --- |',
      '| c   |     |'
    ])
  })

  it('finds cells by column', () => {
    const line = '| Outlook | 0.246 |'
    expect(cellAt(line, 3)).toBe(0)
    expect(cellAt(line, 12)).toBe(1)
    expect(cellStart(line, 1)).toBe(12)
  })
})
