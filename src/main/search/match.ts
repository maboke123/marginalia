import { fold } from '../../shared/text'
import type { SearchHit } from '../../shared/types'

/** Search terms: every word must appear, in any order, ignoring case and accents. */
export function terms(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean)
}

/** Where the first term first appears, if the text contains every term. */
export function matchAt(folded: string, words: string[]): number | null {
  let first: number | null = null
  for (const word of words) {
    const i = folded.indexOf(word)
    if (i === -1) return null
    if (first === null) first = i
  }
  return first
}

/** A line of context around a match, with the matched words marked. */
export function snippet(
  text: string,
  folded: string,
  words: string[],
  at: number,
  radius = 70
): Pick<SearchHit, 'snippet' | 'marks'> {
  let start = Math.max(0, at - radius)
  let end = Math.min(text.length, at + radius * 2)
  // Start and end on word boundaries where possible.
  if (start > 0) {
    const space = text.indexOf(' ', start)
    if (space !== -1 && space < at) start = space + 1
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end)
    if (space > at) end = space
  }
  const lead = start > 0 ? '…' : ''
  const body = text.slice(start, end).replace(/\s/g, ' ')
  const part = folded.slice(start, end)
  const marks: [number, number][] = []
  for (const word of words) {
    for (let i = part.indexOf(word); i !== -1; i = part.indexOf(word, i + word.length)) {
      marks.push([lead.length + i, lead.length + i + word.length])
    }
  }
  marks.sort((a, b) => a[0] - b[0])
  return { snippet: lead + body + (end < text.length ? '…' : ''), marks }
}

/** Paragraphs of a note (split at blank lines) with the line they start on, 1-based. */
export function paragraphs(text: string): { line: number; from: number; to: number }[] {
  const out: { line: number; from: number; to: number }[] = []
  const re = /\n(?:[ \t]*\n)+/g
  let from = 0
  let line = 1
  for (let m = re.exec(text); ; m = re.exec(text)) {
    const to = m ? m.index : text.length
    if (text.slice(from, to).trim()) out.push({ line, from, to })
    if (!m) break
    line += text.slice(from, re.lastIndex).split('\n').length - 1
    from = re.lastIndex
  }
  return out
}
