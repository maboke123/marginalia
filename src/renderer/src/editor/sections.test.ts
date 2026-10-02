import { describe, expect, it } from 'vitest'
import {
  blockInsert,
  endOfContent,
  findSection,
  headingPath,
  headings,
  textAround
} from './sections'

const NOTE = [
  '# Decision trees',
  '',
  '## 4. Choosing a test',
  '',
  '### Entropy',
  '',
  '$$',
  '# not a heading',
  '$$',
  '',
  '### Information gain',
  '',
  'Gain is $IG(S,t)$.',
  '',
  '```',
  '## also not a heading',
  '```',
  '',
  '## 5. Pruning',
  '',
  'Later.',
  ''
].join('\n')

describe('headings', () => {
  it('finds headings outside code and math blocks', () => {
    expect(headings(NOTE).map((h) => `${h.level} ${h.title}`)).toEqual([
      '1 Decision trees',
      '2 4. Choosing a test',
      '3 Entropy',
      '3 Information gain',
      '2 5. Pruning'
    ])
  })

  it('gives the heading path at a position', () => {
    expect(headingPath(NOTE, NOTE.indexOf('Gain is'))).toEqual([
      'Decision trees',
      '4. Choosing a test',
      'Information gain'
    ])
    expect(headingPath(NOTE, NOTE.indexOf('Later'))).toEqual(['Decision trees', '5. Pruning'])
    expect(headingPath('No headings here', 3)).toEqual([])
  })
})

describe('findSection', () => {
  it('finds a section by title, with or without hashes, or by path', () => {
    for (const title of [
      'Information gain',
      '### information gain',
      'Choosing a test > Information gain'
    ]) {
      const s = findSection(NOTE, title)!
      expect(NOTE.slice(s.from, s.to)).toMatch(/^### Information gain[\s\S]*```\n\n$/)
    }
  })

  it('prefers an exact title and falls back to a partial one', () => {
    expect(findSection(NOTE, 'Choosing a test')!.heading.title).toBe('4. Choosing a test')
    expect(findSection(NOTE, 'Entropy')!.heading.title).toBe('Entropy')
    expect(findSection(NOTE, 'Boosting')).toBeNull()
  })
})

describe('blockInsert', () => {
  const apply = (text: string, pos: number, md: string): string => {
    const { from, insert } = blockInsert(text, pos, md)
    return text.slice(0, from) + insert + text.slice(from)
  }

  it('adds a paragraph at the end of a section', () => {
    const s = findSection(NOTE, '5. Pruning')!
    const out = apply(NOTE, endOfContent(NOTE, s.from, s.to), 'Short version.')
    expect(out.endsWith('## 5. Pruning\n\nLater.\n\nShort version.\n')).toBe(true)

    const gain = findSection(NOTE, 'Information gain')!
    const mid = apply(NOTE, endOfContent(NOTE, gain.from, gain.to), '- weighted average')
    expect(mid).toContain('```\n\n- weighted average\n\n## 5. Pruning')
  })

  it('works in an empty note and between paragraphs', () => {
    expect(apply('', 0, 'First')).toBe('First\n')
    expect(apply('A\n\nB', 1, 'New')).toBe('A\n\nNew\n\nB')
  })
})

describe('textAround', () => {
  it('sends a small note whole and a large one by section', () => {
    expect(textAround(NOTE, 10)).toBe(NOTE)
    const big = '# A\n\n' + 'x'.repeat(300) + '\n\n# B\n\nshort\n'
    expect(textAround(big, big.indexOf('short'), 100)).toBe('# B\n\nshort\n')
  })
})
