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
 * Finds `query` in the page text and returns rectangles around it, merged per line.
 * Whitespace and case are ignored, because PDFs often split words over runs, leave out the
 * spaces between them, or use ligatures (NFKC turns "ﬁ" into "fi").
 */
export function findTextRects(runs: TextRun[], query: string): Rect[] | null {
  const wanted = [...query.normalize('NFKC').toLowerCase()].filter((c) => !/\s/.test(c)).join('')
  if (!wanted) return null

  let haystack = ''
  const owner: [run: number, char: number][] = []
  runs.forEach((run, r) => {
    ;[...run.str].forEach((ch, c) => {
      for (const n of ch.normalize('NFKC').toLowerCase()) {
        if (/\s/.test(n)) continue
        haystack += n
        owner.push([r, c])
      }
    })
  })

  const start = haystack.indexOf(wanted)
  if (start === -1) return null

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
  return mergeLineRects(rects)
}
