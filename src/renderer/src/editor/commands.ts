import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { EditorSelection, type EditorState } from '@codemirror/state'
import type { Command, EditorView, KeyBinding } from '@codemirror/view'
import { useApp } from '../store'
import { slideLink } from './links'
import { notePath } from './livePreview'
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

export function insertTable(view: EditorView): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const blank = line.text.trim() === ''
  const prefix = blank ? '' : '\n\n'
  const text = prefix + NEW_TABLE.join('\n') + '\n'
  const from = blank ? line.from : line.to
  view.dispatch({
    changes: { from, to: blank ? line.to : line.to, insert: text },
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

export function insertMathBlock(view: EditorView): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const blank = line.text.trim() === ''
  const prefix = blank ? '' : '\n\n'
  const from = blank ? line.from : line.to
  view.dispatch({
    changes: { from, to: blank ? line.to : from, insert: `${prefix}$$\n\n$$` },
    selection: { anchor: from + prefix.length + 3 },
    userEvent: 'input'
  })
}

function wrap(marker: string): Command {
  return (view) => {
    view.dispatch(
      view.state.changeByRange((range) => ({
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker }
        ],
        range: EditorSelection.range(range.from + marker.length, range.to + marker.length)
      })),
      { userEvent: 'input' }
    )
    return true
  }
}

function setHeading(view: EditorView, level: number): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const existing = /^#{1,6}\s+/.exec(line.text)?.[0].length ?? 0
  view.dispatch({
    changes: { from: line.from, to: line.from + existing, insert: '#'.repeat(level) + ' ' },
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
  { key: 'Enter', run: (view) => tableEnter(view) || mathBlockEnter(view) },
  { key: 'Mod-b', run: wrap('**') },
  { key: 'Mod-i', run: wrap('*') }
]

// ---------------------------------------------------------------------------------------------
// Slash menu

const hotkeyHint = (detail: string | undefined): string | undefined => {
  const { hotkeys } = useApp.getState().settings
  return detail && detail in hotkeys ? hotkeys[detail as keyof typeof hotkeys] : detail
}

interface SlashCommand {
  label: string
  detail?: string
  run(view: EditorView): void
}

const SLASH_COMMANDS: SlashCommand[] = [
  { label: 'Heading 1', run: (v) => setHeading(v, 1) },
  { label: 'Heading 2', run: (v) => setHeading(v, 2) },
  { label: 'Heading 3', run: (v) => setHeading(v, 3) },
  { label: 'Table', run: insertTable },
  { label: 'Math block', detail: '$$', run: insertMathBlock },
  { label: 'Image', detail: 'from a file', run: (v) => void insertImages(v) },
  { label: 'Slide link', detail: 'slideLink', run: (v) => void insertSlideLink(v) },
  {
    label: 'Slide snapshot',
    detail: 'snapshot',
    run: () => useApp.getState().startSnapshot()
  }
]

/** "/" at the start of a line or after a space opens the command list. */
export function slashCommands(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/(?:^|\s)\/[\w ]*$/)
  if (!match) return null
  const slash = match.from + match.text.indexOf('/')
  const options: Completion[] = SLASH_COMMANDS.map((command) => ({
    label: command.label,
    // Hotkey hints follow the settings.
    detail: hotkeyHint(command.detail),
    apply: (view, _completion, _from, to) => {
      view.dispatch({ changes: { from: slash, to, insert: '' } })
      command.run(view)
    }
  }))
  return { from: slash + 1, options, validFor: /^[\w ]*$/ }
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
