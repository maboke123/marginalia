import { fold } from '../../../shared/text'

export interface FuzzyMatch {
  score: number
  /** Positions in the text that matched, for bold letters in the list. */
  indices: number[]
}

const BOUNDARY = /[\s/_\-.()]/

/**
 * Matches the letters of `query` in order anywhere in `text` ("b2dt" finds "B2 Decision trees").
 * Consecutive letters and letters at the start of a word score higher.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = fold(query).replace(/\s+/g, '')
  const t = fold(text)
  if (!q) return { score: 0, indices: [] }
  const indices: number[] = []
  let score = 0
  let from = 0
  for (const ch of q) {
    // Prefer the next occurrence at a word start, if there is one before the next plain one.
    let i = t.indexOf(ch, from)
    if (i === -1) return null
    for (let j = i; j !== -1; j = t.indexOf(ch, j + 1)) {
      if (j === 0 || BOUNDARY.test(t[j - 1])) {
        if (indices.length && i === indices[indices.length - 1] + 1) break
        i = j
        break
      }
    }
    const previous = indices[indices.length - 1]
    score += 1
    if (previous !== undefined && i === previous + 1) score += 3
    if (i === 0 || BOUNDARY.test(t[i - 1])) score += 2
    score -= Math.min(i - from, 10) * 0.1
    indices.push(i)
    from = i + 1
  }
  return { score: score - t.length * 0.01, indices }
}
