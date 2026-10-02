import { NOTEBOOK_COLORS, type NotebookColor } from './types'

/**
 * Coloured text in Markdown, written the way Obsidian reads it:
 * `<span style="color: red">text</span>`. Only the notebook colour names are recognised, so the
 * app can draw them with its theme tokens and they stay readable in dark mode.
 */

export const TEXT_COLORS = NOTEBOOK_COLORS
export type TextColor = NotebookColor

const NAMES = TEXT_COLORS.join('|')
export const OPEN_TAG = new RegExp(`^<span style=["']color:\\s*(${NAMES})\\s*;?\\s*["']>`, 'i')
export const CLOSE_TAG = /^<\/span>/i
const SPAN = new RegExp(`<span style=["']color:\\s*(${NAMES})\\s*;?\\s*["']>(.*?)</span>`, 'gi')
const ANY_TAG = new RegExp(`<span style=["']color:\\s*(?:${NAMES})\\s*;?\\s*["']>|</span>`, 'gi')

export const openTag = (color: TextColor): string => `<span style="color: ${color}">`
export const CLOSE = '</span>'

export interface ColorSpan {
  from: number
  /** End of the opening tag: where the coloured text starts. */
  openTo: number
  /** Start of the closing tag: where the coloured text ends. */
  closeFrom: number
  to: number
  color: TextColor
}

/** Coloured spans on one line. They do not nest and never cross a line break. */
export function colorSpans(line: string): ColorSpan[] {
  const out: ColorSpan[] = []
  for (const m of line.matchAll(SPAN)) {
    const from = m.index
    const to = from + m[0].length
    out.push({
      from,
      openTo: to - CLOSE.length - m[2].length,
      closeFrom: to - CLOSE.length,
      to,
      color: m[1].toLowerCase() as TextColor
    })
  }
  return out
}

/** Colour tags replaced by spaces, so offsets and line numbers stay valid (search). */
export const blankColorTags = (text: string): string =>
  text.replace(ANY_TAG, (tag) => ' '.repeat(tag.length))

export interface Recolored {
  text: string
  from: number
  to: number
}

/**
 * Gives line[from, to) the colour (null removes it), splitting or merging spans so they never
 * nest. With from === to: inside coloured text the whole span changes, elsewhere an empty span
 * is inserted to type into. Returns the new line and the range to select, or null if nothing
 * changes.
 */
export function recolor(
  line: string,
  from: number,
  to: number,
  color: TextColor | null
): Recolored | null {
  const spans = colorSpans(line)

  if (from === to) {
    const span = spans.find((s) => s.openTo <= from && from <= s.closeFrom)
    if (span) {
      if (span.color === color) return null
      const inner = line.slice(span.openTo, span.closeFrom)
      const tagged = color ? openTag(color) + inner + CLOSE : inner
      const start = span.from + (color ? openTag(color).length : 0)
      return {
        text: line.slice(0, span.from) + tagged + line.slice(span.to),
        from: start,
        to: start + inner.length
      }
    }
    if (!color) return null
    const at = from + openTag(color).length
    return {
      text: line.slice(0, from) + openTag(color) + CLOSE + line.slice(from),
      from: at,
      to: at
    }
  }

  // Strip all colour tags into one colour per character, change the range, write it back.
  const chars: { ch: string; color: TextColor | null }[] = []
  let plainFrom = -1
  let plainTo = -1
  let pos = 0
  const mark = (raw: number): void => {
    if (plainFrom === -1 && raw >= from) plainFrom = chars.length
    if (plainTo === -1 && raw >= to) plainTo = chars.length
  }
  const take = (end: number, c: TextColor | null): void => {
    for (; pos < end; pos++) {
      mark(pos)
      chars.push({ ch: line[pos], color: c })
    }
  }
  for (const span of spans) {
    take(span.from, null)
    for (; pos < span.openTo; pos++) mark(pos)
    take(span.closeFrom, span.color)
    for (; pos < span.to; pos++) mark(pos)
  }
  take(line.length, null)
  mark(line.length)
  if (plainFrom >= plainTo) return null

  for (let i = plainFrom; i < plainTo; i++) chars[i].color = color
  let text = ''
  let current: TextColor | null = null
  let selFrom = 0
  let selTo = 0
  chars.forEach(({ ch, color: c }, i) => {
    if (c !== current) {
      if (current) text += CLOSE
      if (c) text += openTag(c)
      current = c
    }
    if (i === plainFrom) selFrom = text.length
    text += ch
    if (i === plainTo - 1) selTo = text.length
  })
  if (current) text += CLOSE
  return text === line ? null : { text, from: selFrom, to: selTo }
}
