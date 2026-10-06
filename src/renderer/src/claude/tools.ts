import { isolateHistory } from '@codemirror/commands'
import { Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type {
  AnnotationPages,
  Highlight,
  PageAnnotations,
  Stroke,
  TextBox,
  TextMarkup
} from '../../../shared/annotations'
import {
  insertBlankPage,
  isBlankPage,
  MAX_BLANKS_PER_SLIDE,
  slideOf
} from '../../../shared/blankPages'
import type { ToolCall, ToolReply } from '../../../shared/claude'
import { pageUnit } from '../../../shared/palette'
import {
  addItem,
  findItem,
  moveToPage,
  newId,
  pageOf,
  removeItems,
  replaceItem,
  type AnnotationDoc,
  type Kind
} from '../annotations/doc'
import { round, strokeBounds, translateStroke } from '../annotations/geometry'
import { findTextRects } from '../annotations/findText'
import { marginSlot } from '../annotations/margin'
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

/** A page to annotate: a page of the PDF, or a blank page I added after a slide (3.1). */
function annotationPage(args: Args, open: OpenPdf & { doc: AnnotationDoc }): number {
  const page = Number(args.page)
  if (!isBlankPage(page)) return pageArg(args, open.pdf)
  if (!open.doc.getState().pages[String(page)]?.blank) {
    throw new ToolError(`There is no blank page ${args.page}; add_blank_page makes one`)
  }
  return page
}

function colorArg(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new ToolError(`Colours are hex like #cf222e, not "${value}"`)
  }
  return value
}

const KINDS: Kind[] = ['textBoxes', 'highlights', 'strokes', 'images']

function findAny(pages: AnnotationPages, page: number, id: string): Kind {
  const kind = KINDS.find((k) => findItem(pages, { page, kind: k, id }))
  if (!kind) throw new ToolError(`No annotation "${id}" on page ${page}; use list_annotations`)
  return kind
}

const who = (author: string): string => (author === 'claude' ? 'yours' : 'mine')

/** One page's annotations with ids and positions, so Claude can change them. */
function listPage(key: string, page: PageAnnotations): string[] {
  const n = Math.round
  const blank = isBlankPage(Number(key))
  const lines = [
    blank ? `Page ${key} (blank page after slide ${slideOf(Number(key))}):` : `Page ${key}:`
  ]
  for (const b of page.textBoxes) {
    const style = [b.fontSize && `size ${round(b.fontSize)}`, b.color].filter(Boolean).join(', ')
    const at = `x=${n(b.x)} y=${n(b.y)} width=${n(b.width)}${style ? `, ${style}` : ''}`
    lines.push(`- text box ${b.id} (${who(b.author)}) at ${at}:\n${b.markdown}`)
  }
  for (const h of page.highlights) {
    lines.push(`- ${h.style ?? 'highlight'} ${h.id} (${who(h.author)}, ${h.color}): "${h.text}"`)
  }
  for (const s of page.strokes) {
    const [x, y, w, h] = strokeBounds(s)
    const box = `x=${n(x)}..${n(x + w)} y=${n(y)}..${n(y + h)}`
    lines.push(`- ${s.tool} stroke ${s.id} (${who(s.author)}, ${s.color}) in ${box}`)
  }
  for (const im of page.images ?? []) {
    lines.push(`- image ${im.id} at x=${n(im.x)} y=${n(im.y)}, ${n(im.width)}x${n(im.height)}`)
  }
  if (lines.length === 1) lines.push('- nothing')
  return lines
}

/**
 * Changes annotations as one undo step, after I accept it when I want to be asked. `preview`
 * shows the change on the page while I decide.
 */
async function changeAnnotations(
  open: OpenPdf & { doc: AnnotationDoc },
  label: string,
  preview: (decide: (accept: boolean) => void) => () => void,
  fn: (pages: AnnotationPages) => AnnotationPages
): Promise<void> {
  const accepted = await useChat.getState().confirm(label, preview)
  if (!accepted) throw new ToolError(REJECTED)
  open.doc.getState().change(fn)
}

/** Selects an item while I decide, so I see which one Claude means. */
function pointAt(
  doc: AnnotationDoc,
  page: number,
  kind: Kind,
  id: string
): (decide: (accept: boolean) => void) => () => void {
  return () => {
    doc.getState().select({ page, kind, id })
    return () => doc.getState().select(null)
  }
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
    const open = await showPdf(path, slideOf(Number(args.page) || 1))
    const page = annotationPage(args, open)
    const size = open.sizes[slideOf(page) - 1]
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
    const style = args.style as TextMarkup | undefined
    const highlight: Highlight = {
      id: newId('h'),
      color: colorArg(args.color) ?? useApp.getState().settings.highlightColors[0],
      ...(style && style !== 'highlight' && { style }),
      text: wanted,
      rects,
      author: 'claude'
    }
    await annotate(open, page, { highlight }, `Highlight “${wanted}” on p.${page}`)
    return { text: `Highlighted "${wanted}" on page ${page} of ${path}.` }
  },

  async list_annotations(args) {
    const path = fileArg(args, 'pdf')
    const open = openPdf(path)
    const pages = open?.doc
      ? open.doc.getState().pages
      : ((await window.api.vault.readAnnotations(path)).file?.pages ?? {})
    const keys = args.page !== undefined ? [String(Number(args.page))] : Object.keys(pages)
    keys.sort((a, b) => Number(a) - Number(b))
    if (!keys.length) return { text: `${path} has no annotations.` }
    const lines = keys.flatMap((key) => listPage(key, pageOf(pages, Number(key))))
    const head = `Annotations on ${path} (x and y in PDF points from the top-left of the slide):`
    return { text: [head, ...lines].join('\n') }
  },

  async edit_annotation(args) {
    const path = fileArg(args, 'pdf')
    const open = await showPdf(path, slideOf(Number(args.page) || 1))
    const page = annotationPage(args, open)
    const id = String(args.id ?? '')
    const { pages } = open.doc.getState()
    const kind = findAny(pages, page, id)
    const to = args.to_page === undefined ? page : annotationPage({ page: args.to_page }, open)
    const color = colorArg(args.color)
    const n = (key: string): number | undefined =>
      typeof args[key] === 'number' ? round(args[key] as number) : undefined

    let changed: (pages: AnnotationPages) => AnnotationPages
    let preview = pointAt(open.doc, page, kind, id)
    if (kind === 'textBoxes') {
      const box = findItem(pages, { page, kind, id })!
      const next: TextBox = {
        ...box,
        ...(typeof args.markdown === 'string' && { markdown: args.markdown.trim() }),
        x: n('x') ?? box.x,
        y: n('y') ?? box.y,
        width: Math.max(20, n('width') ?? box.width),
        ...(n('font_size') !== undefined && { fontSize: Math.max(4, n('font_size')!) }),
        ...(color && { color })
      }
      if (!next.markdown) {
        throw new ToolError('A text box needs text; delete_annotations removes it')
      }
      changed = (p) => replaceItem(p, page, 'textBoxes', next)
      preview = (decide) => {
        open.doc.getState().setGhost({ page: to, textBox: next, decide })
        return () => open.doc.getState().setGhost(null)
      }
    } else if (kind === 'highlights') {
      const next: Highlight = { ...findItem(pages, { page, kind, id })!, ...(color && { color }) }
      const style = args.style as TextMarkup | undefined
      if (style === 'highlight') delete next.style
      else if (style) next.style = style
      changed = (p) => replaceItem(p, page, 'highlights', next)
    } else if (kind === 'strokes') {
      const stroke = findItem(pages, { page, kind, id })!
      const [x, y] = strokeBounds(stroke)
      const moved = translateStroke(stroke, (n('x') ?? x) - x, (n('y') ?? y) - y)
      changed = (p) => replaceItem(p, page, 'strokes', { ...moved, ...(color && { color }) })
    } else {
      const image = findItem(pages, { page, kind: 'images', id })!
      const width = n('width') ?? image.width
      const height = round((image.height * width) / image.width)
      const next = { ...image, x: n('x') ?? image.x, y: n('y') ?? image.y, width, height }
      changed = (p) => replaceItem(p, page, 'images', next)
    }
    const moving = to !== page
    await changeAnnotations(
      open,
      moving ? `Move an annotation to p.${to}` : `Change an annotation on p.${page}`,
      preview,
      (p) => (moving ? moveToPage(changed(p), { page, kind, id }, to, (i) => i) : changed(p))
    )
    return { text: `Changed ${id}${moving ? ` and moved it to page ${to}` : ''}.` }
  },

  async delete_annotations(args) {
    const path = fileArg(args, 'pdf')
    const open = await showPdf(path, slideOf(Number(args.page) || 1))
    const page = annotationPage(args, open)
    const ids = Array.isArray(args.ids) ? args.ids.map(String) : []
    if (!ids.length) throw new ToolError('No ids given')
    const kinds = ids.map((id) => findAny(open.doc.getState().pages, page, id))
    const what = ids.length === 1 ? 'an annotation' : `${ids.length} annotations`
    await changeAnnotations(
      open,
      `Remove ${what} on p.${page}`,
      pointAt(open.doc, page, kinds[0], ids[0]),
      (p) => KINDS.reduce((acc, kind) => removeItems(acc, page, kind, ids), p)
    )
    return { text: `Removed ${ids.join(', ')} from page ${page}.` }
  },

  async add_blank_page(args) {
    const path = fileArg(args, 'pdf')
    const open = await showPdf(path, slideOf(Number(args.after_page) || 1))
    const below = annotationPage({ page: args.after_page }, open)
    const planned = insertBlankPage(open.doc.getState().pages, below)
    if (!planned) {
      throw new ToolError(`A slide can have at most ${MAX_BLANKS_PER_SLIDE} blank pages`)
    }
    // Made again on the pages as they are once I accept, in case I changed something meanwhile.
    await changeAnnotations(
      open,
      `Add a blank page after p.${below}`,
      () => () => {},
      (p) => insertBlankPage(p, below)?.pages ?? p
    )
    const { width, height } = open.sizes[slideOf(below) - 1]
    const size = `${Math.round(width)}x${Math.round(height)} points`
    return {
      text: `Added blank page ${planned.id} (${size}). Write on it with page ${planned.id}.`
    }
  },

  async add_drawing(args) {
    const path = fileArg(args, 'pdf')
    const open = await showPdf(path, slideOf(Number(args.page) || 1))
    const page = annotationPage(args, open)
    const lines: unknown[] = Array.isArray(args.lines) ? args.lines : []
    const unit = pageUnit(open.sizes[slideOf(page) - 1].width)
    const { ink } = useApp.getState()
    const color = colorArg(args.color) ?? ink.penColor
    const width = round((typeof args.width === 'number' ? args.width : ink.penWidth) * unit)
    const strokes: Stroke[] = lines.map((line) => {
      const points = (Array.isArray(line) ? line : []).filter(
        (p): p is [number, number] =>
          Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number'
      )
      if (points.length < 2) throw new ToolError('Each line needs at least two [x, y] points')
      return {
        id: newId('s'),
        tool: 'pen',
        color,
        width,
        points: points.map(([x, y]) => [round(x), round(y), 0.5]),
        author: 'claude'
      }
    })
    if (!strokes.length) throw new ToolError('Nothing to draw')
    await changeAnnotations(
      open,
      `Draw on ${fileName(path)} p.${page}`,
      (decide) => {
        open.doc.getState().setGhost({ page, strokes, decide })
        return () => open.doc.getState().setGhost(null)
      },
      (p) => strokes.reduce((acc, s) => addItem(acc, page, 'strokes', s), p)
    )
    const count = `${strokes.length} line${strokes.length === 1 ? '' : 's'}`
    return { text: `Drew ${count} on page ${page}.` }
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
