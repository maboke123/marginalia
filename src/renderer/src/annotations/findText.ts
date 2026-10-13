import { mergeLineRects, type Rect } from './geometry'

/** A run of text on a page, in page points from the top-left (like the annotations). */
export interface TextRun {
  str: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * One character as search compares it: lower case without accents, ligatures split ("ﬁ" ->
 * "fi"), and "" for whitespace.
 */
function searchChars(ch: string): string {
  return ch
    .normalize('NFKD')
    .replace(/\p{M}|\s/gu, '')
    .toLowerCase()
}

/** Text as search compares it, so "Énergie  ﬁnale" contains "energiefinale". */
export const searchable = (text: string): string => [...text].map(searchChars).join('')

/** Whether `text` contains `query`, ignoring case, accents and whitespace. */
export function containsText(text: string, query: string): boolean {
  const wanted = searchable(query)
  return !!wanted && searchable(text).includes(wanted)
}

/**
 * Finds every place `query` is in the page text, as rectangles merged per line. Whitespace,
 * case and accents are ignored, because PDFs often split words over runs, leave out the
 * spaces between them, or use ligatures.
 */
export function findAllTextRects(runs: TextRun[], query: string): Rect[][] {
  const wanted = searchable(query)
  if (!wanted) return []

  let haystack = ''
  const owner: [run: number, char: number][] = []
  runs.forEach((run, r) => {
    ;[...run.str].forEach((ch, c) => {
      for (const n of searchChars(ch)) {
        haystack += n
        owner.push([r, c])
      }
    })
  })

  const found: Rect[][] = []
  for (
    let start = haystack.indexOf(wanted);
    start !== -1;
    start = haystack.indexOf(wanted, start + wanted.length)
  ) {
    const spans = new Map<number, [number, number]>()
    for (const [r, c] of owner.slice(start, start + wanted.length)) {
      const span = spans.get(r)
      spans.set(r, span ? [Math.min(span[0], c), Math.max(span[1], c + 1)] : [c, c + 1])
    }
    const rects: Rect[] = [...spans].map(([r, [from, to]]) => {
      const run = runs[r]
      const perChar = run.width / Math.max(1, [...run.str].length)
      return [run.x + from * perChar, run.y, (to - from) * perChar, run.height]
    })
    found.push(mergeLineRects(rects))
  }
  return found
}

/** The first place `query` is in the page text, or null. */
export function findTextRects(runs: TextRun[], query: string): Rect[] | null {
  return findAllTextRects(runs, query)[0] ?? null
}
