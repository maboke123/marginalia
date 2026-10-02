import { describe, expect, it } from 'vitest'
import { fold } from '../../../shared/text'
import { fuzzyMatch } from './fuzzy'

describe('fold', () => {
  it('drops case and accents without moving characters', () => {
    expect(fold('Économie Één ÇA')).toBe('economie een ca')
    expect(fold('Größe ﬁ')).toHaveLength('Größe ﬁ'.length)
  })
})

describe('fuzzyMatch', () => {
  it('matches letters in order and rejects the rest', () => {
    expect(fuzzyMatch('b2dt', 'Machine Learning/B2 Decision trees')).not.toBeNull()
    expect(fuzzyMatch('tdb2', 'Machine Learning/B2 Decision trees')).toBeNull()
    expect(fuzzyMatch('econ', 'Économie/Les 1.md')).not.toBeNull()
  })

  it('ranks word starts and runs of letters higher', () => {
    const score = (q: string, t: string): number => fuzzyMatch(q, t)!.score
    expect(score('sum', 'ML/B2/Summary.md')).toBeGreaterThan(score('sum', 'ML/B2/Consumer.md'))
    expect(score('dt', 'ML/Decision trees.pdf')).toBeGreaterThan(score('dt', 'ML/Bedtime.pdf'))
  })

  it('reports the matched positions', () => {
    expect(fuzzyMatch('st', 'Summary/Stats')!.indices).toEqual([0, 9])
  })
})
