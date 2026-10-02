import { describe, expect, it } from 'vitest'
import { fold } from '../../shared/text'
import { matchAt, paragraphs, snippet, terms } from './match'

describe('terms and matchAt', () => {
  it('needs every word, in any order, ignoring case and accents', () => {
    const text = fold('De entropie H(S) daalt na de splitsing op Outlook.')
    expect(matchAt(text, terms('outlook ENTROPIE'))).toBe(text.indexOf('outlook'))
    expect(matchAt(text, terms('entropie gini'))).toBeNull()
    expect(matchAt(fold('Régression logistique'), terms('regression'))).toBe(0)
  })
})

describe('snippet', () => {
  it('cuts around the match on word boundaries and marks every word', () => {
    const text =
      'x '.repeat(100) +
      'information gain picks the split with the largest gain ' +
      'y '.repeat(100)
    const words = terms('gain')
    const at = matchAt(fold(text), words)!
    const s = snippet(text, fold(text), words, at, 30)
    expect(s.snippet.startsWith('…')).toBe(true)
    expect(s.snippet.endsWith('…')).toBe(true)
    expect(s.marks.map(([a, b]) => s.snippet.slice(a, b))).toEqual(['gain', 'gain'])
  })

  it('keeps short text whole', () => {
    const s = snippet('Gain is IG(S,t).', fold('Gain is IG(S,t).'), ['gain'], 0)
    expect(s).toEqual({ snippet: 'Gain is IG(S,t).', marks: [[0, 4]] })
  })
})

describe('paragraphs', () => {
  it('splits a note at blank lines and knows each starting line', () => {
    const note = '# Title\n\nFirst paragraph\nstill first\n\n\n## Next\n  \nLast'
    expect(paragraphs(note).map((p) => [p.line, note.slice(p.from, p.to)])).toEqual([
      [1, '# Title'],
      [3, 'First paragraph\nstill first'],
      [7, '## Next'],
      [9, 'Last']
    ])
  })
})
