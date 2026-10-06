import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { EditorSelection, type EditorState } from '@codemirror/state'
import type { Command, EditorView, KeyBinding } from '@codemirror/view'
import { useApp } from '../store'
import { TEXT_COLORS } from '../../../shared/textColor'
import { setTextColor } from './colorBar'
import { claudeEnter } from './inlineClaude'
import { slideLink } from './links'
import { notePath } from './livePreview'
import { nextHeadingLevel } from './sections'
import {
  NEW_TABLE,
  cellAt,
  cellStart,
  emptyRow,
  formatTable,
  isSeparator,
  isTableLine,
  splitRow
} from './tables'

// ---------------------------------------------------------------------------------------------
// Tables

interface TableAt {
  from: number
  to: number
  lines: string[]
  /** Line index of the cursor within the table. */
  row: number
  cell: number
}

function tableAt(state: EditorState): TableAt | null {
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  if (!isTableLine(line.text)) return null
  let first = line.number
  let last = line.number
  while (first > 1 && isTableLine(state.doc.line(first - 1).text)) first--
  while (last < state.doc.lines && isTableLine(state.doc.line(last + 1).text)) last++
  const lines: string[] = []
  for (let n = first; n <= last; n++) lines.push(state.doc.line(n).text)
  if (lines.length < 2 || !isSeparator(lines[1])) return null
  return {
    from: state.doc.line(first).from,
    to: state.doc.line(last).to,
    lines,
    row: line.number - first,
    cell: cellAt(line.text, head - line.from)
  }
}

/** Rewrites the table aligned, with cell (row, cell) of the result selected. */
function writeTable(
  view: EditorView,
  table: TableAt,
  lines: string[],
  row: number,
  cell: number
): void {
  const formatted = formatTable(lines)
  const text = formatted.join('\n')
  let offset = 0
  for (let i = 0; i < row; i++) offset += formatted[i].length + 1
  // Select the cell's text, so typing replaces it like in a spreadsheet.
  const anchor = table.from + offset + cellStart(formatted[row], cell)
  const length = (splitRow(formatted[row])[cell] ?? '').length
  view.dispatch({
    changes: { from: table.from, to: table.to, insert: text },
    selection: { anchor, head: anchor + length },
    scrollIntoView: true,
    userEvent: 'input.table'
  })
}

function moveCell(direction: 1 | -1): Command {
  return (view) => {
    const table = tableAt(view.state)
    if (!table) return false
    const columns = Math.max(...table.lines.map((l) => splitRow(l).length))
    let { row, cell } = table
    let lines = table.lines
    cell += direction
    if (cell >= columns) {
      cell = 0
      row++
    } else if (cell < 0) {
      cell = columns - 1
      row--
    }
    if (row === 1) row += direction
    if (row < 0) return true
    // Tab past the last cell adds a row.
    if (row >= lines.length) lines = [...lines, emptyRow(columns)]
    writeTable(view, table, lines, row, cell)
    return true
  }
}

/** Enter in a row adds a row under it; Enter on an empty last row leaves the table. */
const tableEnter: Command = (view) => {
  const table = tableAt(view.state)
  if (!table) return false
  const columns = Math.max(...table.lines.map((l) => splitRow(l).length))
  const current = splitRow(table.lines[table.row])
  const isLast = table.row === table.lines.length - 1
  if (isLast && table.row > 1 && current.every((c) => c === '')) {
    const formatted = formatTable(table.lines.slice(0, -1)).join('\n')
    view.dispatch({
      changes: { from: table.from, to: table.to, insert: formatted + '\n\n' },
      selection: { anchor: table.from + formatted.length + 2 },
      userEvent: 'input.table'
    })
    return true
  }
  const lines = [...table.lines]
  const at = table.row === 0 ? 2 : table.row + 1
  lines.splice(at, 0, emptyRow(columns))
  writeTable(view, table, lines, at, 0)
  return true
}

/**
 * Where a new block goes: in place of a blank cursor line, else under the cursor line. The
 * prefix keeps a blank line above, so the block does not join the paragraph before it.
 */
function blockSpot(view: EditorView): { from: number; to: number; prefix: string } {
  const { doc } = view.state
  const line = doc.lineAt(view.state.selection.main.head)
  if (line.text.trim() !== '') return { from: line.to, to: line.to, prefix: '\n\n' }
  const above = line.number > 1 && doc.line(line.number - 1).text.trim() !== ''
  return { from: line.from, to: line.to, prefix: above ? '\n' : '' }
}

export function insertTable(view: EditorView): void {
  const { from, to, prefix } = blockSpot(view)
  const text = prefix + NEW_TABLE.join('\n') + '\n'
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + prefix.length + 2, head: from + prefix.length + 10 },
    userEvent: 'input'
  })
}

// ---------------------------------------------------------------------------------------------
// Math and formatting

/** "$$" then Enter opens a display math block, with the cursor on the empty middle line. */
const mathBlockEnter: Command = (view) => {
  const { state } = view
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  if (line.text.trim() !== '$$' || head !== line.to) return false
  // An opening $$ is one that is not closed by a later line; count the $$ lines above.
  let open = 0
  for (let n = 1; n < line.number; n++) {
    if (state.doc.line(n).text.trim() === '$$') open++
  }
  if (open % 2 === 1) return false
  view.dispatch({
    changes: { from: head, insert: '\n\n$$' },
    selection: { anchor: head + 1 },
    userEvent: 'input'
  })
  return true
}

/** A block with an empty line inside for the cursor: math ($$) or code (```). */
function insertFenced(view: EditorView, fence: string): void {
  const { from, to, prefix } = blockSpot(view)
  view.dispatch({
    changes: { from, to, insert: `${prefix}${fence}\n\n${fence}` },
    selection: { anchor: from + prefix.length + fence.length + 1 },
    userEvent: 'input'
  })
}

export const insertMathBlock = (view: EditorView): void => insertFenced(view, '$$')

function insertDivider(view: EditorView): void {
  const { from, to, prefix } = blockSpot(view)
  const text = `${prefix}---\n\n`
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    userEvent: 'input'
  })
}

function wrap(before: string, after = before): Command {
  return (view) => {
    view.dispatch(
      view.state.changeByRange((range) => ({
        changes: [
          { from: range.from, insert: before },
          { from: range.to, insert: after }
        ],
        range: EditorSelection.range(range.from + before.length, range.to + before.length)
      })),
      { userEvent: 'input' }
    )
    return true
  }
}

/** A heading, list, task or quote mark at the start of a line. */
const LINE_MARK = /^(#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+\[[ xX]\][ \t]+|[-*+][ \t]+|\d+[.)][ \t]+)/

/** Turns the cursor line into a heading, list item or quote ("" makes it plain text). */
function setLineMark(view: EditorView, mark: string): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const indent = /^[ \t]*/.exec(line.text)![0]
  const existing = LINE_MARK.exec(line.text.slice(indent.length))?.[0].length ?? 0
  const from = line.from + indent.length
  view.dispatch({
    changes: { from, to: from + existing, insert: mark },
    // A cursor at the insert point would otherwise stay in front of the new "## ".
    selection: { anchor: line.to - existing + mark.length },
    userEvent: 'input'
  })
}

export function insertText(view: EditorView, text: string): void {
  view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input' })
  view.focus()
}

export function insertSlideLink(view: EditorView): boolean {
  const { pdfView, showError } = useApp.getState()
  if (!pdfView) {
    showError('Open slides to link to the current slide')
    return false
  }
  insertText(view, slideLink(view.state.facet(notePath), pdfView.path, pdfView.page))
  return true
}

async function insertImages(view: EditorView): Promise<void> {
  const links = await window.api.vault.importImages(view.state.facet(notePath)).catch((err) => {
    useApp.getState().showError(err.message)
    return []
  })
  if (links.length) insertText(view, links.map((l) => `![](${l})`).join('\n'))
}

export const editorKeymap: KeyBinding[] = [
  { key: 'Tab', run: moveCell(1) },
  { key: 'Shift-Tab', run: moveCell(-1) },
  { key: 'Enter', run: (view) => tableEnter(view) || mathBlockEnter(view) || claudeEnter(view) },
  { key: 'Mod-b', run: wrap('**') },
  { key: 'Mod-i', run: wrap('*') },
  // Replaces CodeMirror's "undo selection", which nobody misses; text boxes use Ctrl+U too.
  { key: 'Mod-u', run: wrap('<u>', '</u>') }
]

// ---------------------------------------------------------------------------------------------
// Slash menu

const hotkeyHint = (detail: string | undefined): string | undefined => {
  const { hotkeys } = useApp.getState().settings
  return detail && detail in hotkeys ? hotkeys[detail as keyof typeof hotkeys] : detail
}

/** Puts `before` and `after` around the cursor, for formatting picked from the menu. */
function insertAround(view: EditorView, before: string, after: string): void {
  const at = view.state.selection.main.head
  view.dispatch({
    changes: { from: at, insert: before + after },
    selection: { anchor: at + before.length },
    userEvent: 'input'
  })
}

interface SlashCommand {
  label: string
  /** What it writes, or a hotkey action whose current keys are shown instead. */
  detail?: string
  run(view: EditorView): void
}

const label = (name: string): string => name[0].toUpperCase() + name.slice(1)

// Sections in menu order; the commands keep their order within a section.
const SLASH_SECTIONS: [string, SlashCommand[]][] = [
  [
    'Headings',
    [
      ...[1, 2, 3, 4, 5, 6].map((level) => ({
        label: `Heading ${level}`,
        detail: '#'.repeat(level),
        run: (v: EditorView) => setLineMark(v, '#'.repeat(level) + ' ')
      })),
      { label: 'Plain text', detail: 'no heading or list', run: (v) => setLineMark(v, '') }
    ]
  ],
  [
    'Lists and blocks',
    [
      { label: 'Bullet list', detail: '-', run: (v) => setLineMark(v, '- ') },
      { label: 'Numbered list', detail: '1.', run: (v) => setLineMark(v, '1. ') },
      { label: 'Task list', detail: '- [ ]', run: (v) => setLineMark(v, '- [ ] ') },
      { label: 'Quote', detail: '>', run: (v) => setLineMark(v, '> ') },
      { label: 'Table', detail: '| |', run: insertTable },
      { label: 'Math block', detail: '$$', run: insertMathBlock },
      { label: 'Code block', detail: '```', run: (v) => insertFenced(v, '```') },
      { label: 'Divider', detail: '---', run: insertDivider }
    ]
  ],
  [
    'Text',
    [
      { label: 'Bold', detail: 'Ctrl+B', run: (v) => insertAround(v, '**', '**') },
      { label: 'Italic', detail: 'Ctrl+I', run: (v) => insertAround(v, '*', '*') },
      { label: 'Underline', detail: 'Ctrl+U', run: (v) => insertAround(v, '<u>', '</u>') },
      { label: 'Strikethrough', detail: '~~', run: (v) => insertAround(v, '~~', '~~') },
      { label: 'Inline math', detail: '$', run: (v) => insertAround(v, '$', '$') },
      { label: 'Inline code', detail: '`', run: (v) => insertAround(v, '`', '`') },
      { label: 'Link', detail: '[text](url)', run: (v) => insertAround(v, '[', ']()') }
    ]
  ],
  [
    'Text colour',
    [
      ...TEXT_COLORS.map((color) => ({
        label: `${label(color)} text`,
        run: (v: EditorView) => void setTextColor(v, color)
      })),
      { label: 'Normal colour', detail: 'remove colour', run: (v) => void setTextColor(v, null) }
    ]
  ],
  [
    'Slides',
    [
      { label: 'Slide link', detail: 'slideLink', run: (v) => void insertSlideLink(v) },
      {
        label: 'Slide snapshot',
        detail: 'snapshot',
        run: () => useApp.getState().startSnapshot()
      },
      { label: 'Image', detail: 'from a file', run: (v) => void insertImages(v) }
    ]
  ],
  [
    'Claude',
    [
      {
        label: 'Ask Claude',
        detail: 'write here, then Enter',
        run: (v) => insertText(v, '/claude ')
      }
    ]
  ]
]

/** "/" at the start of a line or after a space opens the command list. */
export function slashCommands(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/(?:^|\s)\/[\w ]*$/)
  if (!match) return null
  const slash = match.from + match.text.indexOf('/')
  // "/claude what to write" is a request (Enter sends it), not a menu search.
  if (/^\/claude\s/i.test(context.state.sliceDoc(slash, context.pos))) return null
  // The heading level I probably want comes first, so "/" and Enter gives it.
  const next = `Heading ${nextHeadingLevel(context.state.doc.toString(), slash)}`
  let order = 1
  const options: Completion[] = SLASH_SECTIONS.flatMap(([name, commands], rank) =>
    commands.map((command) => ({
      label: command.label,
      // Hotkey hints follow the settings.
      detail: command.label === next ? `${command.detail}  next` : hotkeyHint(command.detail),
      section: { name, rank },
      // Without a query the list is sorted by this; keep the order above.
      sortText: command.label === next ? '000' : String(order++).padStart(3, '0'),
      apply: (view: EditorView, _completion: Completion, _from: number, to: number) => {
        view.dispatch({ changes: { from: slash, to, insert: '' } })
        command.run(view)
      }
    }))
  )
  return {
    from: slash + 1,
    options,
    // Without this the open list would keep matching while a /claude request is typed.
    validFor: (text) => /^[\w ]*$/.test(text) && !/^claude\s/i.test(text)
  }
}

// ---------------------------------------------------------------------------------------------
// Pasting and dropping images

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg'
}

/** Saves image files into assets/ and inserts links at `pos`. Returns false if none were images. */
export function insertImageFiles(view: EditorView, files: File[], pos: number): boolean {
  const images = files.filter((f) => IMAGE_EXTENSIONS[f.type])
  if (!images.length) return false
  const note = view.state.facet(notePath)
  ;(async () => {
    const links: string[] = []
    for (const file of images) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      links.push(await window.api.vault.saveAsset(note, bytes, IMAGE_EXTENSIONS[file.type]))
    }
    const text = links.map((l) => `![](${l})`).join('\n')
    view.dispatch({
      changes: { from: pos, insert: text },
      selection: { anchor: pos + text.length },
      userEvent: 'input.paste'
    })
  })().catch((err: Error) => useApp.getState().showError(`Image not saved: ${err.message}`))
  return true
}
