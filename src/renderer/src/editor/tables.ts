/**
 * GitHub-style Markdown tables as plain text. Pure functions, so the editor commands built on
 * them (Tab to the next cell, Enter for a new row) stay small.
 */

export type Align = 'left' | 'center' | 'right' | null

const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

export function isTableLine(line: string): boolean {
  return line.trimStart().startsWith('|')
}

export function isSeparator(line: string): boolean {
  return SEPARATOR.test(line) && line.includes('-')
}

/** Cells of one row, without the outer pipes. `\|` stays inside its cell. */
export function splitRow(line: string): string[] {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1)
  const cells: string[] = []
  let cell = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && text[i + 1] === '|') {
      cell += '\\|'
      i++
    } else if (text[i] === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += text[i]
    }
  }
  cells.push(cell.trim())
  return cells
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return null
}

function separatorCell(align: Align, width: number): string {
  const dashes = '-'.repeat(Math.max(3, width - (align === 'center' ? 2 : align ? 1 : 0)))
  if (align === 'center') return `:${dashes}:`
  if (align === 'left') return `:${dashes}`
  if (align === 'right') return `${dashes}:`
  return dashes
}

function pad(text: string, width: number, align: Align): string {
  const space = width - text.length
  if (align === 'right') return ' '.repeat(space) + text
  if (align === 'center') {
    const left = Math.floor(space / 2)
    return ' '.repeat(left) + text + ' '.repeat(space - left)
  }
  return text + ' '.repeat(space)
}

/** Lines of a table with every column padded to the same width. */
export function formatTable(lines: string[]): string[] {
  const rows = lines.map(splitRow)
  const separatorIndex = lines.findIndex(isSeparator)
  const columns = Math.max(...rows.map((r) => r.length))
  const aligns: Align[] = Array.from({ length: columns }, (_, c) =>
    separatorIndex >= 0 ? alignOf(rows[separatorIndex][c] ?? '') : null
  )
  const widths = Array.from({ length: columns }, (_, c) =>
    Math.max(3, ...rows.map((r, i) => (i === separatorIndex ? 0 : (r[c] ?? '').length)))
  )
  return rows.map((row, i) => {
    const cells = widths.map((w, c) =>
      i === separatorIndex ? separatorCell(aligns[c], w) : pad(row[c] ?? '', w, aligns[c])
    )
    return `| ${cells.join(' | ')} |`
  })
}

/** Index of the cell that column `ch` on a formatted or unformatted row falls in. */
export function cellAt(line: string, ch: number): number {
  let cell = -1
  for (let i = 0; i < Math.min(ch, line.length); i++) {
    if (line[i] === '|' && line[i - 1] !== '\\') cell++
  }
  return Math.max(0, cell)
}

/** Offset in the line of the text of cell `index` (just after "| "). */
export function cellStart(line: string, index: number): number {
  let cell = -1
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '|' && line[i - 1] !== '\\') {
      cell++
      if (cell === index) return Math.min(line.length, i + 2)
    }
  }
  return line.length
}

export function emptyRow(columns: number): string {
  return `| ${Array.from({ length: columns }, () => '   ').join(' | ')} |`
}

export const NEW_TABLE = [
  '| Column 1 | Column 2 |',
  '| -------- | -------- |',
  '|          |          |'
]
