// What Claude's answer to a /claude request does to the text: new text where the request
// was, plus changes to text that is already there ("change the formula above").

export interface Edit {
  find: string
  replace: string
}

export interface WriteAnswer {
  /** New text for the spot of the request; empty when only existing text changes. */
  insert: string
  edits: Edit[]
}

export interface Change {
  from: number
  to: number
  insert: string
}

const BLOCK = /<{7}\s*FIND[^\n]*\n([\s\S]*?)\n?={7}[^\n]*\n([\s\S]*?)\n?>{7}[^\n]*(?:\n|$)/g

/** Claude sometimes wraps its text in a code fence anyway; the note wants the content. A chart
 * (mermaid, vega-lite) or code fence is the content itself. */
function unwrap(text: string): string {
  const fenced = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/.exec(text.trim())
  return (fenced ? fenced[1] : text).trim()
}

/** Splits an answer into FIND/REPLACE blocks and the new text around them. */
export function parseAnswer(answer: string): WriteAnswer {
  const edits: Edit[] = []
  const rest = answer.replace(BLOCK, (_, find: string, replace: string) => {
    edits.push({ find, replace })
    return ''
  })
  return { insert: unwrap(rest), edits }
}

/**
 * The answer as it goes in at `from`. A block (several lines, a heading, a table, a fence) only
 * parses at the start of a line, and inside a list item only when each line is indented like
 * the item: otherwise $$ math or a chart showed as plain text.
 */
export function placeInsert(text: string, from: number, insert: string): string {
  const block = insert.includes('\n') || /^(#{1,6}\s|\||```|>\s)/.test(insert)
  if (!block) return insert
  const before = text.slice(text.lastIndexOf('\n', from - 1) + 1, from)
  const lead = /^\s*/.exec(before)![0]
  const onOwnLine = lead.length === before.length
  const item = /^\s*(?:[-*+]|\d+[.)])\s+/.exec(before)
  const indent = !onOwnLine && item ? lead + ' '.repeat(item[0].length - lead.length) : lead
  const body = insert
    .split('\n')
    .map((line, i) => (i === 0 || !line ? line : indent + line))
    .join('\n')
  if (onOwnLine) return body
  // After text: on a new line, inside the list item when the request was in one.
  return (item ? '\n' : '\n\n') + indent + body
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where `find` occurs; when spacing differs a little, where it occurs with any spacing. */
function occurrences(text: string, find: string): { from: number; to: number }[] {
  const exact: { from: number; to: number }[] = []
  for (let i = text.indexOf(find); i !== -1 && find; i = text.indexOf(find, i + 1)) {
    exact.push({ from: i, to: i + find.length })
  }
  if (exact.length || !find.trim()) return exact
  const loose = new RegExp(escape(find.trim()).replace(/\s+/g, '\\s+'), 'g')
  return [...text.matchAll(loose)].map((m) => ({ from: m.index, to: m.index + m[0].length }))
}

/**
 * The changes to make, as one undo step: the request replaced by the new text, and each edit
 * at the occurrence nearest the request (usually "the formula above"). Edits that cannot be
 * found, or that overlap another change, are reported instead of guessed.
 */
export function planWrite(
  text: string,
  request: { from: number; to: number },
  answer: WriteAnswer
): { changes: Change[]; missing: string[] } {
  const { from } = request
  let { to } = request
  // Nothing new to add and the request had its own line: take the line out entirely.
  if (!answer.insert && (from === 0 || text[from - 1] === '\n') && text[to] === '\n') to += 1
  const changes: Change[] = [{ from, to, insert: placeInsert(text, from, answer.insert) }]
  const missing: string[] = []
  const overlaps = (c: { from: number; to: number }): boolean =>
    changes.some((d) => c.from < d.to && c.to > d.from)

  for (const edit of answer.edits) {
    const found = occurrences(text, edit.find).filter((o) => !overlaps(o))
    if (!found.length) {
      missing.push(edit.find)
      continue
    }
    const distance = (o: { from: number; to: number }): number =>
      o.to <= from ? from - o.to : o.from - to
    const nearest = found.reduce((a, b) => (distance(b) < distance(a) ? b : a))
    changes.push({ ...nearest, insert: edit.replace })
  }
  return { changes: changes.sort((a, b) => a.from - b.from), missing }
}

/** The text after the changes (sorted, not overlapping, as planWrite returns them). */
export function applyChanges(text: string, changes: Change[]): string {
  return [...changes]
    .reverse()
    .reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), text)
}

/** Where a position ends up after the changes, so a cursor stays where it was. */
export function mapPosition(pos: number, changes: Change[]): number {
  let shift = 0
  for (const c of changes) {
    if (pos >= c.to) shift += c.insert.length - (c.to - c.from)
    else if (pos > c.from) return c.from + shift
  }
  return pos + shift
}
