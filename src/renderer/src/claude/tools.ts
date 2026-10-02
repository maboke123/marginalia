import { isolateHistory } from '@codemirror/commands'
import { Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Highlight, TextBox } from '../../../shared/annotations'
import type { ToolCall, ToolReply } from '../../../shared/claude'
import { addItem, newId, pageOf, type AnnotationDoc } from '../annotations/doc'
import { findTextRects } from '../annotations/findText'
import { marginSlot } from '../annotations/margin'
import { HIGHLIGHT_COLORS } from '../annotations/palette'
import { pendingEdit, setPendingEdit } from '../editor/proposal'
import { blockInsert, endOfContent, findSection, headings } from '../editor/sections'
import { openNote, openPdf, whenOpen, type OpenNote, type OpenPdf } from '../lib/open'
import { findNode } from '../lib/tree'
import { loadPdf } from '../pdf/pdfjs'
import { renderPage } from '../pdf/snapshot'
import { pageRuns, pageText } from '../pdf/text'
import { useApp } from '../store'
import { useChat } from './chat'
import { buildPacket, currentChips } from './context'

type Args = Record<string, unknown>
type Result = Omit<ToolReply, 'id' | 'ok'>

/** A failure Claude should read, like "No heading ..." */
class ToolError extends Error {}

const fileName = (path: string): string => path.split('/').pop() ?? path

function fileArg(args: Args, kind: 'pdf' | 'markdown' | 'any'): string {
  const path = String(args.file ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
  const node = findNode(useApp.getState().nodes, path)
  if (!node)
    throw new ToolError(`No file "${path}" in the vault. Use vault paths like in the context.`)
  if (kind !== 'any' && node.kind !== kind) {
    throw new ToolError(`"${path}" is not a ${kind === 'pdf' ? 'PDF' : 'Markdown file'}`)
  }
  return path
}

function pageArg(args: Args, pdf: PDFDocumentProxy): number {
  const page = Number(args.page)
  if (!Number.isInteger(page) || page < 1 || page > pdf.numPages) {
    throw new ToolError(`Page ${args.page} does not exist; the PDF has ${pdf.numPages} pages`)
  }
  return page
}

/** Uses the open viewer's document, or loads the PDF for a moment. */
async function withPdf<T>(path: string, fn: (pdf: PDFDocumentProxy) => Promise<T>): Promise<T> {
  const open = openPdf(path)
  if (open) return fn(open.pdf)
  const task = loadPdf(await window.api.vault.readFile(path))
  try {
    return await fn(await task.promise)
  } finally {
    void task.destroy()
  }
}

/**
 * Shows a file Claude is about to change. Next to slides it opens in lecture mode, so I see
 * the change without losing the slide I am on.
 */
function show(path: string, page?: number): void {
  const app = useApp.getState()
  const pdf = /\.pdf$/i.test(path)
  const other = app.activeFile
  if (!app.lectureMode && other && other !== path && /\.pdf$/i.test(other) !== pdf) {
    useApp.setState({
      lectureMode: true,
      slidesFile: pdf ? path : other,
      summaryFile: pdf ? other : path
    })
  }
  app.openFile(path, page)
}

async function showNote(path: string): Promise<OpenNote> {
  if (!openNote(path)) show(path)
  const note = await whenOpen(() => openNote(path))
  if (!note) throw new ToolError(`Could not open ${path}`)
  return note
}

async function showPdf(path: string, page: number): Promise<OpenPdf & { doc: AnnotationDoc }> {
  show(path, page)
  const open = await whenOpen(() => openPdf(path))
  if (!open) throw new ToolError(`Could not open ${path}`)
  if (!open.doc) {
    throw new ToolError(
      `Annotations are off for ${fileName(path)} (damaged annotation file, or the PDF changed)`
    )
  }
  return open as OpenPdf & { doc: AnnotationDoc }
}

const REJECTED = 'I rejected this change; nothing was changed. Do not try again unless I ask.'

/** Applies a change to an open note as one undo step, after I accept it if I want to be asked. */
async function editNote(
  view: EditorView,
  change: { from: number; to: number; insert: string },
  label: string
): Promise<void> {
  const original = view.state.sliceDoc(change.from, change.to)
  // Positions may move while I type elsewhere; the preview keeps track of them.
  let range = { from: change.from, to: change.to }
  const accepted = await useChat.getState().confirm(label, (decide) => {
    // Scrolls to the preview without moving my cursor, in case I am still typing.
    view.dispatch({
      effects: [
        setPendingEdit.of({ ...change, original, decide }),
        EditorView.scrollIntoView(change.to, { y: 'center' })
      ]
    })
    return () => {
      const pending = view.dom.isConnected ? view.state.field(pendingEdit, false) : null
      if (!pending) return
      range = { from: pending.from, to: pending.to }
      view.dispatch({ effects: setPendingEdit.of(null) })
    }
  })
  if (!accepted) throw new ToolError(REJECTED)
  if (!view.dom.isConnected) throw new ToolError('The note was closed before the change was made')

  const { from, to } = range
  if (view.state.sliceDoc(from, to) !== original) {
    throw new ToolError('That text changed in the meantime; read the summary again')
  }
  view.dispatch({
    changes: { from, to, insert: change.insert },
    effects: EditorView.scrollIntoView(from, { y: 'center' }),
    // Its own undo step, not merged with my typing before or after.
    annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.claude')]
  })
}

/** Adds an annotation as one undo step, shown as a ghost first if I want to be asked. */
async function annotate(
  open: OpenPdf & { doc: AnnotationDoc },
  page: number,
  item: { textBox: TextBox } | { highlight: Highlight },
  label: string
): Promise<void> {
  const { doc } = open
  const accepted = await useChat.getState().confirm(label, (decide) => {
    doc.getState().setGhost({ page, ...item, decide })
    return () => doc.getState().setGhost(null)
  })
  if (!accepted) throw new ToolError(REJECTED)
  doc
    .getState()
    .change((pages) =>
      'textBox' in item
        ? addItem(pages, page, 'textBoxes', item.textBox)
        : addItem(pages, page, 'highlights', item.highlight)
    )
}

function noteText(path: string): Promise<string> {
  const open = openNote(path)
  return open ? Promise.resolve(open.view.state.doc.toString()) : window.api.vault.readText(path)
}

function headingList(text: string): string {
  const list = headings(text).map((h) => `${'#'.repeat(h.level)} ${h.title}`)
  return list.length ? `Headings in the note:\n${list.join('\n')}` : 'The note has no headings.'
}

const TOOLS: Record<string, (args: Args) => Promise<Result>> = {
  async get_current_view() {
    const { chats, running } = useChat.getState()
    const chat = running ?? ''
    const packet = await buildPacket(chat, currentChips([]), '', chats[chat]?.lastImage ?? null)
    return { text: packet.text, image: packet.images[0] }
  },

  async read_pdf_page(args) {
    const path = fileArg(args, 'pdf')
    return withPdf(path, async (pdf) => {
      const page = pageArg(args, pdf)
      const text = await pageText(pdf, page)
      return {
        text: `${path}, page ${page} of ${pdf.numPages}:\n${text || '(no text layer; see the image)'}`,
        image: { mediaType: 'image/png', data: await renderPage(pdf, page) }
      }
    })
  },

  async read_summary(args) {
    const path = fileArg(args, 'markdown')
    const text = await noteText(path)
    if (!args.heading) return { text: text || '(the note is empty)' }
    const section = findSection(text, String(args.heading))
    if (!section) throw new ToolError(`No heading "${args.heading}". ${headingList(text)}`)
    return { text: text.slice(section.from, section.to) }
  },

  async insert_into_summary(args) {
    const path = fileArg(args, 'markdown')
    const markdown = String(args.markdown ?? '')
    if (!markdown.trim()) throw new ToolError('Nothing to insert')
    const { view } = await showNote(path)
    const text = view.state.doc.toString()
    let pos: number
    let where: string
    if (args.position === 'heading') {
      const section = findSection(text, String(args.heading ?? ''))
      if (!section) throw new ToolError(`No heading "${args.heading}". ${headingList(text)}`)
      pos = endOfContent(text, section.from, section.to)
      where = `under ${section.heading.title}`
    } else if (args.position === 'cursor') {
      pos = view.state.doc.lineAt(view.state.selection.main.head).to
      where = 'at the cursor'
    } else {
      pos = endOfContent(text, 0, text.length)
      where = 'at the end'
    }
    const { from, insert } = blockInsert(text, pos, markdown)
    await editNote(view, { from, to: from, insert }, `Add to ${fileName(path)} ${where}`)
    return { text: `Inserted into ${path} ${where}.` }
  },

  async replace_in_summary(args) {
    const path = fileArg(args, 'markdown')
    const oldText = String(args.old_text ?? '')
    const newText = String(args.new_text ?? '')
    if (!oldText) throw new ToolError('old_text is empty')
    const { view } = await showNote(path)
    const text = view.state.doc.toString()
    const at = text.indexOf(oldText)
    if (at === -1) throw new ToolError('old_text was not found; read the summary again')
    if (text.indexOf(oldText, at + 1) !== -1) {
      throw new ToolError('old_text appears more than once; include more surrounding text')
    }
    await editNote(
      view,
      { from: at, to: at + oldText.length, insert: newText },
      `Change text in ${fileName(path)}`
    )
    return { text: `Replaced the text in ${path}.` }
  },

  async add_text_annotation(args) {
    const path = fileArg(args, 'pdf')
    const markdown = String(args.markdown ?? '').trim()
    if (!markdown) throw new ToolError('The note is empty')
    const open = await showPdf(path, Number(args.page) || 1)
    const page = pageArg(args, open.pdf)
    const size = open.sizes[page - 1]
    const slot = marginSlot(
      pageOf(open.doc.getState().pages, page),
      size.width,
      size.height,
      open.margin
    )
    const box: TextBox = {
      id: newId('t'),
      ...slot,
      ...(typeof args.x === 'number' ? { x: args.x } : {}),
      ...(typeof args.y === 'number' ? { y: args.y } : {}),
      markdown,
      author: 'claude'
    }
    await annotate(open, page, { textBox: box }, `Note on ${fileName(path)} p.${page}`)
    return { text: `Added a text box on page ${page} of ${path}.` }
  },

  async add_highlight(args) {
    const path = fileArg(args, 'pdf')
    const wanted = String(args.text ?? '')
    const open = await showPdf(path, Number(args.page) || 1)
    const page = pageArg(args, open.pdf)
    const rects = findTextRects(await pageRuns(open.pdf, page), wanted)
    if (!rects) {
      const text = (await pageText(open.pdf, page)).slice(0, 1500)
      throw new ToolError(`"${wanted}" is not on page ${page}. The page text is:\n${text}`)
    }
    const highlight: Highlight = {
      id: newId('h'),
      color: HIGHLIGHT_COLORS[0].value,
      text: wanted,
      rects,
      author: 'claude'
    }
    await annotate(open, page, { highlight }, `Highlight “${wanted}” on p.${page}`)
    return { text: `Highlighted "${wanted}" on page ${page} of ${path}.` }
  },

  async goto(args) {
    const path = fileArg(args, 'any')
    const page = args.page ? Number(args.page) : undefined
    useApp.getState().openFile(path, page)
    return { text: `Opened ${path}${page ? ` at page ${page}` : ''}.` }
  }
}

export async function runTool(call: ToolCall): Promise<ToolReply> {
  const tool = TOOLS[call.name]
  if (!tool) return { id: call.id, ok: false, text: `Unknown tool ${call.name}` }
  try {
    return { id: call.id, ok: true, ...(await tool(call.args)) }
  } catch (err) {
    if (!(err instanceof ToolError)) console.error(`[tool ${call.name}]`, err)
    return { id: call.id, ok: false, text: (err as Error).message }
  }
}
