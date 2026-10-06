/** Headings and sections of a Markdown note, for Claude's context and edits. */

export interface Heading {
  level: number
  title: string
  /** Start and end of the heading line. */
  from: number
  to: number
}

/** ATX headings (# Title), skipping code blocks and $$ math blocks. */
export function headings(text: string): Heading[] {
  const out: Heading[] = []
  let pos = 0
  let fence: string | null = null
  let math = false
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (fence) {
      if (trimmed.startsWith(fence)) fence = null
    } else if (/^(```|~~~)/.test(trimmed)) {
      fence = trimmed.slice(0, 3)
    } else if (trimmed === '$$') {
      math = !math
    } else if (!math) {
      const m = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line)
      if (m) out.push({ level: m[1].length, title: m[2], from: pos, to: pos + line.length })
    }
    pos += line.length + 1
  }
  return out
}

/** Titles of the headings the position is under, outermost first. */
export function headingPath(text: string, pos: number): string[] {
  const stack: Heading[] = []
  for (const h of headings(text)) {
    if (h.from > pos) break
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop()
    stack.push(h)
  }
  return stack.map((h) => h.title)
}

/**
 * The heading level most likely wanted on the line at `pos`. Right under a heading with
 * nothing written yet, one level deeper. After some text, what this note usually does after a
 * section of that level (another of the same, one deeper, back up), ties going to the level
 * closest to it. Before any heading, the note's top level.
 */
export function nextHeadingLevel(text: string, pos: number): number {
  const all = headings(text)
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1
  const above = all.filter((h) => h.from < lineStart)
  const last = above[above.length - 1]
  if (!last) return all.length ? Math.min(...all.map((h) => h.level)) : 1
  if (text.slice(last.to, lineStart).trim() === '') return Math.min(last.level + 1, 6)

  const counts = new Map<number, number>()
  for (let i = 1; i < all.length; i++) {
    const [before, after] = [all[i - 1], all[i]]
    // Only sections with text in them; an empty one says nothing about what follows text.
    if (before.level !== last.level || text.slice(before.to, after.from).trim() === '') continue
    if (after.level > last.level + 1) continue
    counts.set(after.level, (counts.get(after.level) ?? 0) + 1)
  }
  let best = last.level
  const distance = (level: number): number => Math.abs(level - last.level)
  for (const [level, count] of counts) {
    const bestCount = counts.get(best) ?? 0
    if (count > bestCount || (count === bestCount && distance(level) < distance(best))) best = level
  }
  return best
}

/** End of a heading's section: before the next heading of the same or a higher level. */
function sectionEnd(text: string, all: Heading[], heading: Heading): number {
  const next = all.find((h) => h.from > heading.from && h.level <= heading.level)
  return next ? next.from : text.length
}

const normalise = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[*_`$]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Finds a section by heading title. Accepts "Information gain", "## Information gain" or a
 * path like "Choosing a test > Information gain"; an exact match wins over a partial one.
 */
export function findSection(
  text: string,
  title: string
): { heading: Heading; from: number; to: number } | null {
  const all = headings(text)
  const wanted = normalise(
    title
      .split('>')
      .pop()!
      .replace(/^#+\s*/, '')
  )
  if (!wanted) return null
  const heading =
    all.find((h) => normalise(h.title) === wanted) ??
    all.find((h) => normalise(h.title).includes(wanted))
  if (!heading) return null
  return { heading, from: heading.from, to: sectionEnd(text, all, heading) }
}

/** Where to add content at the end of a section: after its last non-blank text. */
export function endOfContent(text: string, from: number, to: number): number {
  let end = to
  while (end > from && /\s/.test(text[end - 1])) end--
  return end
}

/** Inserts a Markdown block at `pos` with blank lines around it, as its own paragraph. */
export function blockInsert(
  text: string,
  pos: number,
  markdown: string
): { from: number; insert: string } {
  const before = text.slice(0, pos)
  const after = text.slice(pos)
  const lead =
    before.trim() === '' ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  let trail: string
  if (after.trim() === '') trail = after.startsWith('\n') ? '' : '\n'
  else trail = after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  return { from: pos, insert: lead + markdown.trim() + trail }
}

/**
 * The part of a note that goes to Claude with a question: all of it when small, otherwise
 * the largest section around the cursor that fits, otherwise the text around the cursor.
 */
export function textAround(text: string, pos: number, limit = 20_000): string {
  if (text.length <= limit) return text
  const all = headings(text)
  const enclosing = all.filter((h) => h.from <= pos && sectionEnd(text, all, h) >= pos)
  for (const h of enclosing.sort((a, b) => a.level - b.level)) {
    const end = sectionEnd(text, all, h)
    if (end - h.from <= limit) return text.slice(h.from, end)
  }
  const start = Math.max(0, pos - limit / 2)
  return text.slice(start, start + limit)
}
