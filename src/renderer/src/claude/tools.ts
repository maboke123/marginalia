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
import { DEFAULT_TEXT_SIZE, pageUnit } from '../../../shared/palette'
import {
  addItem,
  createAnnotationDoc,
  findItem,
  moveToPage,
  newId,
  pageOf,
  removeItems,
  replaceItem,
  type AnnotationDoc,
  type Ghost,
  type Kind
} from '../annotations/doc'
import { round, strokeBounds, translateStroke } from '../annotations/geometry'
import { findTextRects } from '../annotations/findText'
import { measurer, planBox } from '../annotations/fit'
import { marginSlot } from '../annotations/margin'
import { pendingEdit, setPendingEdit } from '../editor/proposal'
import { blockInsert, endOfContent, findSection, headings } from '../editor/sections'
import { canvasFrom, formatCanvas, type CanvasData } from '../../../shared/canvas'
import {
  applyChanges,
  describeCanvas,
  type CanvasChange,
  type EditResult
} from '../canvas/claudeEdits'
import { openCanvas, openNote, openPdf, whenOpen, type OpenNote, type OpenPdf } from '../lib/open'
import { flushAll } from '../lib/flush'
import { findNode, isFolder, parentOf } from '../lib/tree'
import { pageHtml } from '../annotations/pageHtml'
import { loadPdf, pageSizes } from '../pdf/pdfjs'
import { renderPage } from '../pdf/snapshot'
import { pageRuns, pageText } from '../pdf/text'
import { useApp } from '../store'
import { useChat } from './chat'
import { buildPacket, currentChips } from './context'
import { contactSheet, drawPages, pageImage, printNote } from '../lib/notePreview'
import { captureArea, captureElement, fullyInView, until, viewOf } from './screenshot'

type Args = Record<string, unknown>
type Result = Omit<ToolReply, 'id' | 'ok'>

/** A failure Claude should read, like "No heading ..." */
class ToolError extends Error {}

const fileName = (path: string): string => path.split('/').pop() ?? path

const KIND_NAMES = { pdf: 'PDF', markdown: 'Markdown file', canvas: 'canvas' }

function fileArg(args: Args, kind: 'pdf' | 'markdown' | 'canvas' | 'any'): string {
  const path = String(args.file ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
  const node = findNode(useApp.getState().nodes, path)
  if (!node)
    throw new ToolError(`No file "${path}" in the vault. Use vault paths like in the context.`)
  if (kind !== 'any' && node.kind !== kind) {
    throw new ToolError(`"${path}" is not a ${KIND_NAMES[kind]}`)
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
  page: number,
  preview: (decide: (accept: boolean) => void) => () => void,
  fn: (pages: AnnotationPages) => AnnotationPages
): Promise<void> {
  const accepted = await useChat.getState().confirm(label, preview, revealPdf(open.path, page))
  if (!accepted) throw new ToolError(REJECTED)
  await applyChange(open, fn)
}

/** The PDF's annotations as open now: closing and opening the PDF again makes a new doc. */
function liveDoc(open: OpenPdf & { doc: AnnotationDoc }): AnnotationDoc {
  return openPdf(open.path)?.doc ?? open.doc
}

/**
 * Applies a change after I accept it: in the viewer when the PDF is open (also when I opened
 * it meanwhile by clicking the change), else in the annotation file.
 */
async function applyChange(
  open: OpenPdf & { doc: AnnotationDoc },
  fn: (pages: AnnotationPages) => AnnotationPages
): Promise<void> {
  const live = openPdf(open.path)?.doc
  if (live) {
    live.getState().change(fn)
    return
  }
  const save = closedSaves.get(open.doc)
  if (!save) throw new ToolError('The PDF was closed before the change was made')
  open.doc.getState().change(fn)
  await save()
}

// PDFs Claude changes without opening them: their doc writes back to the annotation file.
const closedSaves = new WeakMap<AnnotationDoc, () => Promise<void>>()
let closedTasks: { destroy(): Promise<void> }[] = []
// A chat and a learning run may call tools at the same time: the PDFs loaded for them are
// destroyed once no call is running, not under a call that still uses one.
let callsRunning = 0

/** Claude may open files it works on only when I said so in its settings. */
const opensFiles = (): boolean => useChat.getState().settings?.openEditedFiles === true

/** A PDF that is not open, loaded for one tool call; its changes go to the annotation file. */
async function closedPdf(path: string): Promise<OpenPdf & { doc: AnnotationDoc }> {
  const loaded = await window.api.vault.readAnnotations(path).catch((err: Error) => {
    throw new ToolError(`Annotations are off for ${fileName(path)}: ${err.message}`)
  })
  const file = loaded.file
  if (file?.pdfSha256 && file.pdfSha256 !== loaded.pdfSha256) {
    throw new ToolError(`Annotations are off for ${fileName(path)} (the PDF changed)`)
  }
  const task = loadPdf(await window.api.vault.readFile(path))
  closedTasks.push(task)
  const pdf = await task.promise
  const margin = file?.marginWidth ?? useApp.getState().settings.marginWidth
  const doc = createAnnotationDoc(file?.pages ?? {})
  closedSaves.set(doc, () =>
    window.api.vault.writeAnnotations(path, {
      version: 1,
      pdf: fileName(path),
      pdfSha256: loaded.pdfSha256,
      marginWidth: margin,
      pages: doc.getState().pages
    })
  )
  return { path, pdf, doc, sizes: await pageSizes(pdf), margin }
}

/** Opens the PDF at a change that waits for my answer, when I click it in the chat. */
function revealPdf(path: string, page: number): () => Promise<void> {
  return async () => {
    await showPdf(path, slideOf(page), true)
  }
}

/** Selects an item while I decide, so I see which one Claude means. */
function pointAt(
  open: OpenPdf & { doc: AnnotationDoc },
  page: number,
  kind: Kind,
  id: string
): (decide: (accept: boolean) => void) => () => void {
  return () => {
    const doc = liveDoc(open)
    doc.getState().select({ page, kind, id })
    return () => doc.getState().select(null)
  }
}

/** Draws a change as a ghost on the page while I decide. */
function ghostOf(
  open: OpenPdf & { doc: AnnotationDoc },
  ghost: Omit<Ghost, 'decide'>
): (decide: (accept: boolean) => void) => () => void {
  return (decide) => {
    const doc = liveDoc(open)
    doc.getState().setGhost({ ...ghost, decide })
    return () => doc.getState().setGhost(null)
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

/** A folder in the vault for something new, from the tool's `folder`. */
function folderArg(args: Args): string {
  const folder = String(args.folder ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.?\/|\/$/g, '')
  const node = findNode(useApp.getState().nodes, folder)
  if (!node || !isFolder(node)) {
    throw new ToolError(`No folder "${folder}" in the vault; it goes in a course or lesson folder`)
  }
  return folder
}

/** A canvas as open now (with unsaved changes), or as it is on disk. */
async function canvasData(path: string): Promise<CanvasData> {
  const doc = openCanvas(path)?.doc
  if (doc) return doc.getState().data
  try {
    return canvasFrom(await window.api.vault.readText(path))
  } catch (err) {
    throw new ToolError(`${path} cannot be read: ${(err as Error).message}`)
  }
}

function changeCount(changes: CanvasChange[]): string {
  const n = (op: CanvasChange['op']): number => changes.filter((c) => c.op === op).length
  const parts = [
    [n('add_box'), 'new box', 'new boxes'],
    [n('add_arrow'), 'new arrow', 'new arrows'],
    [n('change_box') + n('change_arrow'), 'change', 'changes'],
    [n('delete'), 'removal', 'removals']
  ] as const
  return parts
    .filter(([count]) => count)
    .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`)
    .join(', ')
}

function openMade(path: string, pdf: string | null): void {
  const app = useApp.getState()
  if (pdf && app.lectureMode && app.slidesFile === pdf) void app.showNote(path)
  else show(path)
}

async function showNote(path: string): Promise<OpenNote> {
  if (!openNote(path)) show(path)
  const note = await whenOpen(() => openNote(path))
  if (!note) throw new ToolError(`Could not open ${path}`)
  return note
}

/**
 * The PDF for a change. One that is open already stays where I am reading, unless I asked to go
 * there: jumping back to every change while I follow the lecture is annoying. One that is not
 * open is opened only when the setting says so; otherwise the change goes to its file.
 */
async function showPdf(
  path: string,
  page: number,
  jump = false
): Promise<OpenPdf & { doc: AnnotationDoc }> {
  if (!jump && !openPdf(path) && !opensFiles()) return closedPdf(path)
  if (jump || !openPdf(path)) show(path, page)
  const open = await whenOpen(() => openPdf(path))
  if (!open) throw new ToolError(`Could not open ${path}`)
  if (!open.doc) {
    throw new ToolError(
      `Annotations are off for ${fileName(path)} (damaged annotation file, or the PDF changed)`
    )
  }
  return open as OpenPdf & { doc: AnnotationDoc }
}

/** Waits for an element of the app to appear. */
async function found<T>(get: () => T | null): Promise<T> {
  let item = get()
  await until(() => (item = get()) !== null)
  if (!item) throw new ToolError('It is not on screen')
  return item
}

const REJECTED = 'I rejected this change; nothing was changed. Do not try again unless I ask.'

/**
 * Fits a text box on its page at its font size, like a /claude answer: as wide as it needs up
 * to the page edge, else moved up (not over the boxes above it). When it cannot fit at all,
 * explains the room on a blank page, so Claude moves it there instead of shrinking the text.
 */
function fitOnPage(open: OpenPdf & { doc: AnnotationDoc }, page: number, box: TextBox): TextBox {
  const size = open.sizes[slideOf(page) - 1]
  const unit = pageUnit(size.width)
  const fitPage = { width: size.width * (1 + open.margin), height: size.height, gap: 8 * unit }
  const font = DEFAULT_TEXT_SIZE * unit
  const plan = planBox(open.doc.getState().pages, page, box, fitPage, font)
  if (plan.kind === 'fits') return { ...box, width: plan.width, y: plan.y }
  const n = Math.round
  const tall = n(measurer(box.markdown, box.fontSize ?? font)(plan.width))
  const room = n(size.height - 2 * fitPage.gap)
  throw new ToolError(
    `This text does not fit on page ${page}, not even moved up at the full width of the margin. ` +
      'Do not make the font smaller. Put it on a blank page (add_blank_page) as one box at ' +
      `x=${n(plan.x)}, y=${n(plan.y)}, width=${n(plan.width)}: there it is ${tall} points tall ` +
      `and ${room} fit${tall > room ? ', so split it over two blank pages at a heading' : ''}.`
  )
}

/**
 * Changes a note after I accept it if I want to be asked: in the editor as one undo step when
 * the note is open, else in the file, so the view and the chat stay where I am. `text` is the
 * note as the change was planned on.
 */
async function editNote(
  path: string,
  text: string,
  change: { from: number; to: number; insert: string },
  label: string
): Promise<void> {
  const original = text.slice(change.from, change.to)
  // Positions may move while I type elsewhere; the preview keeps track of them.
  let range = { from: change.from, to: change.to }
  // Only after I click the change in the chat; otherwise my view stays where I am reading.
  let jump = false
  // Closing and opening the note again gives a new editor.
  const current = (): EditorView | null => {
    const view = openNote(path)?.view
    return view?.dom.isConnected ? view : null
  }
  const show = (decide: (accept: boolean) => void): (() => void) => {
    const view = current()
    if (!view || view.state.sliceDoc(range.from, range.to) !== original) return () => {}
    // Scrolling does not move my cursor, in case I am still typing.
    const preview = setPendingEdit.of({ ...range, insert: change.insert, original, decide })
    view.dispatch({
      effects: jump ? [preview, EditorView.scrollIntoView(range.to, { y: 'center' })] : preview
    })
    return () => {
      const pending = view.dom.isConnected ? view.state.field(pendingEdit, false) : null
      if (!pending) return
      range = { from: pending.from, to: pending.to }
      view.dispatch({ effects: setPendingEdit.of(null) })
    }
  }
  const reveal = async (): Promise<void> => {
    jump = true
    await showNote(path)
  }
  const accepted = await useChat.getState().confirm(label, show, reveal)
  if (!accepted) throw new ToolError(REJECTED)
  const changed = new ToolError('That text changed in the meantime; read the summary again')
  const { from, to } = range
  const view = current()
  if (!view) {
    const now = await window.api.vault.readText(path)
    if (now.slice(from, to) !== original) throw changed
    await window.api.vault.writeText(path, now.slice(0, from) + change.insert + now.slice(to))
    return
  }
  if (view.state.sliceDoc(from, to) !== original) throw changed
  view.dispatch({
    changes: { from, to, insert: change.insert },
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
  const accepted = await useChat
    .getState()
    .confirm(label, ghostOf(open, { page, ...item }), revealPdf(open.path, page))
  if (!accepted) throw new ToolError(REJECTED)
  await applyChange(open, (pages) =>
    'textBox' in item
      ? addItem(pages, page, 'textBoxes', item.textBox)
      : addItem(pages, page, 'highlights', item.highlight)
  )
}

const OFF_SCREEN = 'It is drawn off screen, so my view stays put'
const NO_ANNOTATIONS = { strokes: [], highlights: [], textBoxes: [] }

/**
 * A screenshot of a file without showing it on screen: printed in a hidden window. A note
 * comes out as Export as PDF makes it; a slide page as the viewer draws it.
 */
async function offScreenShot(path: string, args: Args): Promise<Result> {
  await flushAll()
  if (/\.canvas$/i.test(path)) {
    const { canvasHtml } = await import('../canvas/exportHtml')
    const pdf = await window.api.vault.printNote(await canvasHtml(path, await canvasData(path)))
    const [page] = await drawPages(pdf, 1568)
    return { text: `All of ${path}. ${OFF_SCREEN}.`, image: await pageImage(page) }
  }
  if (/\.md$/i.test(path)) {
    const pages = await drawPages(await printNote(path), 1000)
    const n = Math.min(Math.max(1, Math.round(Number(args.page) || 1)), pages.length)
    return {
      text:
        `Page ${n} of ${pages.length} of ${path} as A4 (ask for another with page). ` +
        `${OFF_SCREEN}.`,
      image: await pageImage(pages[n - 1])
    }
  }
  const page = Number(args.page) || 1
  const loaded = await window.api.vault.readAnnotations(path).catch(() => null)
  const pages = loaded?.file?.pages ?? {}
  if (isBlankPage(page) && !pages[String(page)]) {
    throw new ToolError(`There is no blank page ${args.page}; add_blank_page makes one`)
  }
  const margin = loaded?.file?.marginWidth ?? useApp.getState().settings.marginWidth
  const task = loadPdf(await window.api.vault.readFile(path))
  try {
    const pdf = await task.promise
    if (slideOf(page) < 1 || slideOf(page) > pdf.numPages) {
      throw new ToolError(`${path} has no page ${args.page}`)
    }
    const html = await pageHtml(path, pdf, page, pages[String(page)] ?? NO_ANNOTATIONS, margin)
    const [drawn] = await drawPages(await window.api.vault.printNote(html), 1400)
    return {
      text:
        `Page ${page} of ${path} with its annotations (${drawn.width}x${drawn.height} px, ` +
        `margin included), as the viewer shows it. ${OFF_SCREEN}.`,
      image: await pageImage(drawn)
    }
  } finally {
    void task.destroy()
  }
}

/** Whether a page (a blank one too; without one, the slide on screen) is wholly in view. */
function pageInView(path: string, page: unknown): boolean {
  const view = useApp.getState().pdfView
  if (view?.path !== path) return false
  const key = page === undefined ? view.page : Number(page)
  const el = document.querySelector<HTMLElement>(
    `.pdf-viewer[data-path="${CSS.escape(path)}"] .pdf-page[data-page="${key}"]`
  )
  const scroller = el?.closest<HTMLElement>('.pdf-scroll')
  return !!el && !!scroller && fullyInView(el, scroller)
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

  async read_pdf_text(args) {
    const path = fileArg(args, 'pdf')
    return withPdf(path, async (pdf) => {
      const from = args.from_page === undefined ? 1 : pageArg({ page: args.from_page }, pdf)
      const to = args.to_page === undefined ? pdf.numPages : pageArg({ page: args.to_page }, pdf)
      const pages: string[] = []
      for (let page = from; page <= to; page++) {
        const text = await pageText(pdf, page)
        pages.push(`--- Page ${page} ---\n${text || '(no text layer; read_pdf_page shows it)'}`)
      }
      const notes = useApp.getState().links[path] ?? []
      const head =
        `${path}, pages ${from} to ${to} of ${pdf.numPages}. ` +
        `Notes linked to it: ${notes.length ? notes.join(', ') : 'none'}.`
      return { text: [head, ...pages].join('\n\n') }
    })
  },

  async create_note(args) {
    const folder = folderArg(args)
    const name = String(args.name ?? '')
      .trim()
      .replace(/\.md$/i, '')
    if (!name) throw new ToolError('The note needs a name')
    const pdf = args.link_to_pdf === undefined ? null : fileArg({ file: args.link_to_pdf }, 'pdf')
    const accepted = await useChat
      .getState()
      .confirm(`New note ${name}.md in ${fileName(folder)}`, () => () => {})
    if (!accepted) throw new ToolError(REJECTED)
    const path = await window.api.vault.createNote(folder, name)
    await window.api.vault.writeText(path, String(args.markdown ?? '').trimEnd() + '\n')
    if (pdf) await window.api.vault.linkNote(pdf, path, 'add')
    await useApp.getState().refresh()
    // Opening it would take me away from what I am reading, and the chat with it.
    useApp
      .getState()
      .showNotice(`Claude made ${fileName(path)}`, [
        { label: 'Open', run: () => openMade(path, pdf) }
      ])
    return { text: `Made ${path}${pdf ? `, linked to ${pdf}` : ''}.` }
  },

  async create_canvas(args) {
    const folder = folderArg(args)
    const name = String(args.name ?? '')
      .trim()
      .replace(/\.canvas$/i, '')
    if (!name) throw new ToolError('The canvas needs a name')
    const accepted = await useChat
      .getState()
      .confirm(`New canvas ${name} in ${fileName(folder)}`, () => () => {})
    if (!accepted) throw new ToolError(REJECTED)
    const path = await window.api.vault.createCanvas(folder, name)
    await useApp.getState().refresh()
    useApp
      .getState()
      .showNotice(`Claude made ${fileName(path)}`, [{ label: 'Open', run: () => show(path) }])
    return { text: `Made ${path}. It is empty; fill it with edit_canvas.` }
  },

  async create_folder(args) {
    const parent = String(args.parent ?? '').trim() ? folderArg({ folder: args.parent }) : ''
    const name = String(args.name ?? '').trim()
    if (!name) throw new ToolError('The folder needs a name')
    const where = parent ? ` in ${fileName(parent)}` : ' (a new course)'
    const accepted = await useChat.getState().confirm(`New folder ${name}${where}`, () => () => {})
    if (!accepted) throw new ToolError(REJECTED)
    const path = await window.api.vault.createFolder(parent, name)
    await useApp.getState().refresh()
    return { text: `Made ${path}.` }
  },

  async rename_item(args) {
    const path = fileArg({ file: args.path }, 'any')
    const name = String(args.name ?? '').trim()
    if (!name) throw new ToolError('A new name is needed')
    const accepted = await useChat
      .getState()
      .confirm(`Rename ${fileName(path)} to ${name}`, () => () => {})
    if (!accepted) throw new ToolError(REJECTED)
    const to = await useApp.getState().rename(path, name, true)
    return { text: to ? `Renamed to ${to}.` : 'The name is the same; nothing changed.' }
  },

  async move_item(args) {
    const path = fileArg({ file: args.path }, 'any')
    const folder = folderArg({ folder: args.to_folder })
    const accepted = await useChat
      .getState()
      .confirm(`Move ${fileName(path)} to ${fileName(folder)}`, () => () => {})
    if (!accepted) throw new ToolError(REJECTED)
    const to = await useApp.getState().move(path, folder, undefined, true)
    return { text: `Moved to ${to}.` }
  },

  async move_to_recycle_bin(args) {
    const path = fileArg({ file: args.path }, 'any')
    // The app's own dialog asks; "ask before editing" does not cover deleting.
    const gone = await useApp.getState().trash(path, true)
    if (!gone) throw new ToolError(REJECTED)
    return { text: `${path} is in the Recycle Bin.` }
  },

  async link_note(args) {
    const pdf = fileArg({ file: args.pdf }, 'pdf')
    const path = fileArg(args, 'any')
    if (!/\.(md|canvas)$/i.test(path)) throw new ToolError(`"${path}" is not a note or canvas`)
    if (parentOf(path) !== parentOf(pdf)) {
      throw new ToolError('A note is only linked to slides in its own folder; move it first')
    }
    await useApp.getState().setLinked(pdf, path, args.linked !== false)
    return { text: `${args.linked !== false ? 'Linked' : 'Unlinked'} ${path} and ${pdf}.` }
  },

  async read_canvas(args) {
    const path = fileArg(args, 'canvas')
    return { text: describeCanvas(path, await canvasData(path)) }
  },

  async edit_canvas(args) {
    const path = fileArg(args, 'canvas')
    const route = useApp.getState().settings.arrowRoute === 'elbow' ? 'right_angles' : 'curved'
    const changes = (Array.isArray(args.changes) ? (args.changes as CanvasChange[]) : []).map(
      (c) => (c.op === 'add_arrow' && !c.line ? { ...c, line: route } : c)
    )
    if (!changes.length) throw new ToolError('No changes given')
    const planned = applyChanges(await canvasData(path), changes)
    if (!planned.data.nodes.length && !planned.data.edges.length && planned.errors.length) {
      throw new ToolError(planned.errors.join('\n'))
    }
    // The preview: what the canvas would be, drawn over it while I decide.
    const preview = (decide: (accept: boolean) => void): (() => void) => {
      const doc = openCanvas(path)?.doc
      if (!doc) return () => {}
      doc.getState().setGhost({ data: applyChanges(doc.getState().data, changes).data, decide })
      return () => doc.getState().setGhost(null)
    }
    const reveal = async (): Promise<void> => {
      if (!openCanvas(path)) show(path)
      const open = await whenOpen(() => openCanvas(path))
      if (open && planned.area) open.reveal(planned.area)
    }
    const accepted = await useChat
      .getState()
      .confirm(`Change ${fileName(path)}: ${changeCount(changes)}`, preview, reveal)
    if (!accepted) throw new ToolError(REJECTED)

    let result: EditResult
    let before: CanvasData
    let after: CanvasData
    const doc = openCanvas(path)?.doc
    if (doc) {
      before = doc.getState().data
      result = applyChanges(before, changes)
      // One undo step; a drag of mine going on meanwhile keeps working.
      doc.getState().change((d) => (d === before ? result.data : applyChanges(d, changes).data))
      after = doc.getState().data
    } else {
      before = canvasFrom(await window.api.vault.readText(path))
      result = applyChanges(before, changes)
      after = result.data
      await window.api.vault.writeText(path, formatCanvas(after))
    }
    const renamed = [...result.added].filter(([mine, real]) => mine !== real)
    return {
      text: [
        `Changed ${path}.`,
        ...renamed.map(([mine, real]) => `Your id ${mine} was taken; it is ${real}.`),
        ...result.errors,
        'Look at it with screenshot to check the layout.'
      ].join('\n'),
      drawn: { path, before: formatCanvas(before), after: formatCanvas(after) }
    }
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
    const view = openNote(path)?.view
    const text = await noteText(path)
    let pos: number
    let where: string
    if (args.position === 'heading') {
      const section = findSection(text, String(args.heading ?? ''))
      if (!section) throw new ToolError(`No heading "${args.heading}". ${headingList(text)}`)
      pos = endOfContent(text, section.from, section.to)
      where = `under ${section.heading.title}`
    } else if (args.position === 'cursor' && view) {
      pos = view.state.doc.lineAt(view.state.selection.main.head).to
      where = 'at the cursor'
    } else {
      pos = endOfContent(text, 0, text.length)
      where = 'at the end'
    }
    const { from, insert } = blockInsert(text, pos, markdown)
    await editNote(path, text, { from, to: from, insert }, `Add to ${fileName(path)} ${where}`)
    return { text: `Inserted into ${path} ${where}.` }
  },

  async replace_in_summary(args) {
    const path = fileArg(args, 'markdown')
    const oldText = String(args.old_text ?? '')
    const newText = String(args.new_text ?? '')
    if (!oldText) throw new ToolError('old_text is empty')
    const text = await noteText(path)
    const at = text.indexOf(oldText)
    if (at === -1) throw new ToolError('old_text was not found; read the summary again')
    if (text.indexOf(oldText, at + 1) !== -1) {
      throw new ToolError('old_text appears more than once; include more surrounding text')
    }
    await editNote(
      path,
      text,
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
    const box = fitOnPage(open, page, {
      id: newId('t'),
      ...slot,
      ...(typeof args.x === 'number' ? { x: round(args.x) } : {}),
      ...(typeof args.y === 'number' ? { y: round(args.y) } : {}),
      ...(typeof args.width === 'number' ? { width: Math.max(20, round(args.width)) } : {}),
      markdown,
      author: 'claude'
    })
    await annotate(open, page, { textBox: box }, `Note on ${fileName(path)} p.${page}`)
    const at = `x=${Math.round(box.x)} y=${Math.round(box.y)} width=${Math.round(box.width)}`
    return { text: `Added a text box on page ${page} of ${path} at ${at}.` }
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
    let preview = pointAt(open, page, kind, id)
    if (kind === 'textBoxes') {
      const box = findItem(pages, { page, kind, id })!
      let next: TextBox = {
        ...box,
        ...(typeof args.markdown === 'string' && { markdown: args.markdown.trim() }),
        x: n('x') ?? box.x,
        y: n('y') ?? box.y,
        width: Math.max(20, n('width') ?? box.width),
        // Smaller than the default only makes text hard to read; moving it makes room instead.
        ...(n('font_size') !== undefined && {
          fontSize: Math.max(
            round(DEFAULT_TEXT_SIZE * pageUnit(open.sizes[slideOf(to) - 1].width)),
            n('font_size')!
          )
        }),
        ...(color && { color })
      }
      if (!next.markdown) {
        throw new ToolError('A text box needs text; delete_annotations removes it')
      }
      const resized = ['markdown', 'x', 'y', 'width', 'font_size', 'to_page'].some(
        (key) => args[key] !== undefined
      )
      if (resized) next = fitOnPage(open, to, next)
      changed = (p) => replaceItem(p, page, 'textBoxes', next)
      preview = ghostOf(open, { page: to, textBox: next })
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
      page,
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
      page,
      pointAt(open, page, kinds[0], ids[0]),
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
      below,
      () => () => {},
      (p) => insertBlankPage(p, below)?.pages ?? p
    )
    const { width, height } = open.sizes[slideOf(below) - 1]
    const size = `${Math.round(width)}x${Math.round(height)} points`
    const gap = 8 * pageUnit(width)
    const full = Math.round(width * (1 + open.margin) - 2 * gap)
    return {
      text:
        `Added blank page ${planned.id} (${size}, ${full + Math.round(2 * gap)} wide with the margin). ` +
        `Write on it with page ${planned.id}: one text box at x=${Math.round(gap)}, ` +
        `y=${Math.round(gap)}, width=${full} uses the whole page; no columns.`
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
      page,
      ghostOf(open, { page, strokes }),
      (p) => strokes.reduce((acc, s) => addItem(acc, page, 'strokes', s), p)
    )
    const count = `${strokes.length} line${strokes.length === 1 ? '' : 's'}`
    return { text: `Drew ${count} on page ${page}.` }
  },

  async preview_pdf_export(args) {
    const path = fileArg(args, 'markdown')
    const pages = await drawPages(await printNote(path), 1000)
    const count = pages.length
    const intro = `${path} exports to ${count} A4 ${count === 1 ? 'page' : 'pages'}.`
    if (args.page !== undefined) {
      const page = Number(args.page)
      if (!Number.isInteger(page) || page < 1 || page > count) {
        throw new ToolError(`Page ${args.page} does not exist; the export has ${count} pages`)
      }
      return { text: `${intro} This is page ${page}.`, image: await pageImage(pages[page - 1]) }
    }
    const shown = pages.slice(0, 12)
    return {
      text:
        `${intro} All pages side by side${count > 12 ? ' (the first 12)' : ''}, left to right ` +
        'and top to bottom. Ask for one page to read it.',
      image: await contactSheet(shown, Math.min(shown.length, 4))
    }
  },

  async screenshot(args) {
    if (args.file === undefined) {
      const shot = await captureArea(null)
      return { text: 'The whole app window as I see it now.', image: shot.image }
    }
    const path = fileArg(args, 'any')
    if (!opensFiles()) {
      // A page of an open PDF is captured live only when all of it is on screen; scrolling
      // to it, even for a moment, would move my view.
      const live = /\.pdf$/i.test(path)
        ? pageInView(path, args.page)
        : !!(openCanvas(path) ?? openNote(path))
      if (!live) return offScreenShot(path, args)
    }
    if (/\.canvas$/i.test(path)) {
      if (!openCanvas(path)) show(path)
      const open = await whenOpen(() => openCanvas(path))
      if (!open) throw new ToolError(`Could not open ${path}`)
      const restore = open.fitAll()
      try {
        const surface = await found(() =>
          document.querySelector<HTMLElement>(`.canvas-surface[data-path="${CSS.escape(path)}"]`)
        )
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const shot = await captureArea(viewOf(surface))
        return { text: `All of ${path}, fitted in the view, as I see it.`, image: shot.image }
      } finally {
        restore()
      }
    }
    if (/\.md$/i.test(path)) {
      await showNote(path)
      const scroller = await found(() =>
        document.querySelector<HTMLElement>('.md-editor .cm-scroller')
      )
      const shot = await captureArea(viewOf(scroller))
      return { text: `The part of ${path} on screen, as I see it.`, image: shot.image }
    }
    // Without a page: the one on screen.
    const view = useApp.getState().pdfView
    const pageArgs = args.page === undefined && view?.path === path ? { page: view.page } : args
    const slide = slideOf(Number(pageArgs.page) || 1)
    if (opensFiles() || !openPdf(path)) show(path, slide)
    const open = await whenOpen(() => openPdf(path))
    if (!open) throw new ToolError(`Could not open ${path}`)
    const page = open.doc
      ? annotationPage(pageArgs, open as OpenPdf & { doc: AnnotationDoc })
      : pageArg(pageArgs, open.pdf)
    const selector = `.pdf-viewer[data-path="${CSS.escape(path)}"] .pdf-page[data-page="${page}"]`
    const el = await found(() => document.querySelector<HTMLElement>(selector))
    const shot = await captureElement(el, el.closest<HTMLElement>('.pdf-scroll')!, () => {
      const canvas = el.querySelector('canvas')
      return isBlankPage(page) || (!!canvas && canvas.width > 0)
    })
    const size = open.sizes[slide - 1]
    const perPoint = shot.width / (size.width * (1 + open.margin))
    const n = (v: number): number => Math.round(v * 100) / 100
    return {
      text:
        `Page ${page} of ${path} as I see it, with everything on it (${shot.width}x${shot.height} ` +
        `px). 1 PDF point is ${n(perPoint)} px here, so x and y in points are the pixel ` +
        `position divided by ${n(perPoint)}. ` +
        (open.margin
          ? `The slide is ${Math.round(size.width)} points wide; the margin starts there.`
          : ''),
      image: shot.image
    }
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
  callsRunning++
  try {
    return { id: call.id, ok: true, ...(await tool(call.args)) }
  } catch (err) {
    if (!(err instanceof ToolError)) console.error(`[tool ${call.name}]`, err)
    return { id: call.id, ok: false, text: (err as Error).message }
  } finally {
    if (--callsRunning === 0) {
      const tasks = closedTasks
      closedTasks = []
      tasks.forEach((t) => void t.destroy())
    }
  }
}
