const SEPARATOR = /^\s*-{3,}\s*$/
const WORD = /[\p{L}\p{N}_]/u

/** The word around `offset` in `text` as [start, end], or null on a space or a symbol. */
export function wordAround(text: string, offset: number): [number, number] | null {
  let start = offset
  let end = offset
  while (start > 0 && WORD.test(text[start - 1])) start--
  while (end < text.length && WORD.test(text[end])) end++
  return end > start ? [start, end] : null
}

/** Where `word` occurs in `text` as a whole word. */
function wordsAt(text: string, word: string): number[] {
  const found: number[] = []
  for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) {
    const before = i > 0 && WORD.test(text[i - 1])
    const after = WORD.test(text[i + word.length] ?? '')
    if (!before && !after) found.push(i)
  }
  return found
}

/**
 * Where a word double-clicked in a drawn box sits in the box's text, to select it when the
 * editor opens. `shown` is the clicked text as drawn (Markdown already rendered) and `offset`
 * the click in it; `part` is the compartment of a class (split at --- lines), null for other
 * boxes.
 */
export function sourceRange(
  source: string,
  part: number | null,
  shown: string,
  offset: number
): [number, number] | null {
  const at = wordAround(shown, offset)
  if (!at) return null
  const word = shown.slice(...at)
  const nth = wordsAt(shown, word).indexOf(at[0])
  const lines: { start: number; text: string }[] = []
  let start = 0
  let k = 0
  for (const text of source.split('\n')) {
    if (part !== null && SEPARATOR.test(text)) k++
    else if (part === null || k === part) lines.push({ start, text })
    start += text.length + 1
  }
  // The line drawn as the clicked text first; Markdown marks can make them differ.
  const whole = shown.trim()
  const ordered = [
    ...lines.filter((l) => l.text.includes(whole)),
    ...lines.filter((l) => !l.text.includes(whole))
  ]
  for (const line of ordered) {
    const hits = wordsAt(line.text, word)
    if (!hits.length) continue
    const i = hits[Math.min(Math.max(nth, 0), hits.length - 1)]
    return [line.start + i, line.start + i + word.length]
  }
  return null
}
