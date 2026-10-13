import { TEXT_COLORS } from './textColor'

/**
 * Part of a text box in another colour or size: `<span style="color: #cf222e">` (a pen colour,
 * or a notebook colour name like in notes) and `<span style="font-size: 1.4em">` (relative to
 * the box, so it scales with it). Both may sit in one tag. Anything else stays plain text.
 */

export interface TextStyle {
  color?: string
  /** Times the size of the box's text. */
  size?: number
}

const COLOR = `(?:${TEXT_COLORS.join('|')}|#[0-9a-f]{6})`
const DECLARATION = `\\s*(?:color:\\s*${COLOR}|font-size:\\s*\\d+(?:\\.\\d+)?em)\\s*`
export const STYLE_TAG = new RegExp(`^<span style=["']((?:${DECLARATION};?)+)["']>`, 'i')
const CLOSE = '</span>'

export function parseStyle(declarations: string): TextStyle {
  const style: TextStyle = {}
  for (const part of declarations.split(';')) {
    const [name, value] = part.split(':').map((s) => s.trim().toLowerCase())
    if (name === 'color' && value) style.color = value
    if (name === 'font-size' && value) style.size = parseFloat(value)
  }
  return style
}

export function styleTag(style: TextStyle): string {
  const parts: string[] = []
  if (style.color) parts.push(`color: ${style.color}`)
  if (style.size) parts.push(`font-size: ${Math.round(style.size * 100) / 100}em`)
  return `<span style="${parts.join('; ')}">`
}

interface Span {
  from: number
  openTo: number
  closeFrom: number
  to: number
  style: TextStyle
}

/** Styled spans in `text`, inner ones included. A closing tag closes the latest open span. */
function spansOf(text: string): Span[] {
  const spans: Span[] = []
  const open: Omit<Span, 'closeFrom' | 'to'>[] = []
  for (let i = text.indexOf('<'); i !== -1; i = text.indexOf('<', i + 1)) {
    const tag = STYLE_TAG.exec(text.slice(i))
    if (tag) {
      open.push({ from: i, openTo: i + tag[0].length, style: parseStyle(tag[1]) })
    } else if (open.length && text.startsWith(CLOSE, i)) {
      spans.push({ ...open.pop()!, closeFrom: i, to: i + CLOSE.length })
    }
  }
  return spans
}

export interface Restyled {
  text: string
  /** The styled text, to keep it selected. */
  from: number
  to: number
}

/**
 * Gives text[from, to) a colour or size; null takes it away again. When the range is exactly a
 * styled span (its text, or with its tags), that span changes instead of a new one nesting in
 * it. Returns null when nothing changes.
 */
export function restyle(
  text: string,
  from: number,
  to: number,
  change: { color?: string | null; size?: number | null }
): Restyled | null {
  if (from >= to) return null
  const span = spansOf(text)
    .filter((s) => (s.openTo === from && s.closeFrom === to) || (s.from === from && s.to === to))
    .pop()
  if (span) {
    const style = { ...span.style }
    if (change.color !== undefined) style.color = change.color ?? undefined
    if (change.size !== undefined) style.size = change.size ?? undefined
    const inner = text.slice(span.openTo, span.closeFrom)
    const tag = style.color || style.size ? styleTag(style) : ''
    const next =
      text.slice(0, span.from) + (tag ? tag + inner + CLOSE : inner) + text.slice(span.to)
    if (next === text) return null
    const start = span.from + tag.length
    return { text: next, from: start, to: start + inner.length }
  }
  const style: TextStyle = {}
  if (change.color) style.color = change.color
  if (change.size) style.size = change.size
  if (!style.color && !style.size) return null
  const tag = styleTag(style)
  return {
    text: text.slice(0, from) + tag + text.slice(from, to) + CLOSE + text.slice(to),
    from: from + tag.length,
    to: to + tag.length
  }
}
