import { create } from 'zustand'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/settings'
import type { NotebookColor, Position, VaultInfo, VaultNode } from '../../shared/types'
import { ERASER_SIZES, PEN_WIDTHS, TEXT_SIZES } from '../../shared/palette'
import { flushAll } from './lib/flush'
import { childrenOf, findNode, isFolder, pairNotes, parentOf, remap } from './lib/tree'

const api = window.api.vault

type NewItem = 'notebook' | 'section' | 'page'

export type Tool = 'select' | 'pen' | 'highlighter' | 'eraser' | 'text'

export interface Ink {
  penColor: string
  penWidth: number
  highlightColor: string
  /** "partial" cuts out only what is under the eraser, "stroke" removes whole strokes. */
  eraserMode: 'partial' | 'stroke'
  eraserSize: number
  textSize: number
  /** Colour for new text boxes; null is the normal text colour. */
  textColor: string | null
}

/** What the slide viewer shows right now; read by the slide-link hotkey and (later) Claude. */
export interface PdfView {
  path: string
  page: number
  pageCount: number
}

/** Ask the open note to put the cursor on a line (from search). */
export interface NoteGoto {
  path: string
  line: number
  nonce: number
}

export type Overlay = 'switcher' | 'search' | 'settings' | null

/** Text selected on a slide; kept when focus moves to the chat, which clears the DOM selection. */
export interface PdfSelection {
  path: string
  page: number
  text: string
}

/** Where the cursor is in the open summary, for Claude's context. */
export interface NoteCursor {
  path: string
  headings: string[]
  selection: string
}

/** The open summary editor, so hotkeys elsewhere in the app can write into it. */
export interface EditorHandle {
  path: string
  insert(text: string): void
}

/** Ask the slide viewer to jump to a page. `nonce` makes repeated clicks on one link work. */
export interface PdfGoto {
  path: string
  page: number
  nonce: number
}

const DEFAULT_NAMES: Record<NewItem, string> = {
  notebook: 'New notebook',
  section: 'New section',
  page: 'Untitled'
}

interface AppState {
  vault: VaultInfo | null
  recent: string[]
  ready: boolean
  nodes: VaultNode[]
  colors: Record<string, NotebookColor>
  /** PDF path -> its linked note, so the sidebar can show the note under its PDF. */
  links: Record<string, string>
  expanded: Record<string, boolean>
  selected: string | null
  /** The file shown when not in lecture mode. */
  activeFile: string | null
  /** The PDF and the note last opened; lecture mode shows them side by side. */
  slidesFile: string | null
  summaryFile: string | null
  lectureMode: boolean
  pdfGoto: PdfGoto | null
  noteGoto: NoteGoto | null
  /** Most recently opened files first, for the quick switcher. */
  recentFiles: string[]
  overlay: Overlay
  editor: EditorHandle | null
  /** Waiting for a rectangle to be dragged on a slide (Ctrl+Shift+S). */
  snapshotting: boolean
  renaming: string | null
  error: string | null
  /** A short confirmation, shown like an error but not as one. */
  notice: string | null
  pdfView: PdfView | null
  pdfSelection: PdfSelection | null
  noteCursor: NoteCursor | null
  tool: Tool
  settings: AppSettings
  ink: Ink

  init(): Promise<void>
  openVault(root?: string): Promise<void>
  refresh(): Promise<void>
  select(path: string | null): void
  setExpanded(path: string, open: boolean): void
  /** Opens a file; a PDF at `page`, a note at `line`. */
  openFile(path: string, page?: number, line?: number): void
  /**
   * Opening a file on purpose (quick switcher, search). In lecture mode a PDF brings its own
   * note along, and a note becomes the note of the slides on screen.
   */
  goTo(path: string, page?: number, line?: number): Promise<void>
  setOverlay(overlay: Overlay): void
  toggleLecture(): Promise<void>
  setEditor(editor: EditorHandle | null): void
  /** Ctrl+Shift+S: drag a rectangle on the slides to put that part into the summary. */
  startSnapshot(): void
  setSnapshotting(on: boolean): void
  startRename(path: string | null): void
  showError(message: string | null): void
  showNotice(message: string | null): void
  /** Saves pending annotations, then writes a flattened copy where I choose. */
  exportPdf(path: string): Promise<void>
  setPdfView(view: PdfView | null): void
  setPdfSelection(selection: PdfSelection | null): void
  setNoteCursor(cursor: NoteCursor | null): void
  setTool(tool: Tool): void
  setInk(ink: Partial<Ink>): void
  saveSettings(change: Partial<AppSettings>): Promise<void>

  create(item: NewItem, parent: string): Promise<void>
  rename(path: string, name: string): Promise<void>
  move(path: string, parent: string, before?: Position): Promise<void>
  trash(path: string): Promise<void>
  setColor(notebook: string, color: NotebookColor | null): Promise<void>
  /** Without `sources` a file dialog asks for them; without `parent` the current section is used. */
  importPdfs(sources?: string[], parent?: string): Promise<void>
}

// Which folders are open is a per-machine convenience, so it lives in localStorage
// rather than in the vault. Storage can be unavailable; the app works without it.
function loadExpanded(root: string): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(`expanded:${root}`) ?? '{}')
  } catch {
    return {}
  }
}

function saveExpanded(root: string, expanded: Record<string, boolean>): void {
  try {
    localStorage.setItem(`expanded:${root}`, JSON.stringify(expanded))
  } catch {
    // ignore
  }
}

function loadRecent(root: string): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(`recent-files:${root}`) ?? '[]')
    return Array.isArray(list) ? list.filter((p) => typeof p === 'string') : []
  } catch {
    return []
  }
}

function saveRecent(root: string, list: string[]): void {
  try {
    localStorage.setItem(`recent-files:${root}`, JSON.stringify(list))
  } catch {
    // ignore
  }
}

export const useApp = create<AppState>((set, get) => {
  /** Runs a vault call and turns a failure into an error message instead of a crash. */
  async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn()
    } catch (err) {
      get().showError(err instanceof Error ? err.message : String(err))
      return undefined
    }
  }

  function updateExpanded(change: (e: Record<string, boolean>) => Record<string, boolean>): void {
    const { vault, expanded } = get()
    const next = change(expanded)
    set({ expanded: next })
    if (vault) saveExpanded(vault.root, next)
  }

  /** Keeps selection, open file and expanded folders pointing at an item that moved. */
  function followMove(from: string, to: string): void {
    const { selected, activeFile, slidesFile, summaryFile, recentFiles } = get()
    set({
      recentFiles: recentFiles.map((p) => remap(p, from, to)),
      selected: selected && remap(selected, from, to),
      activeFile: activeFile && remap(activeFile, from, to),
      slidesFile: slidesFile && remap(slidesFile, from, to),
      summaryFile: summaryFile && remap(summaryFile, from, to)
    })
    updateExpanded((e) =>
      Object.fromEntries(Object.entries(e).map(([p, open]) => [remap(p, from, to), open]))
    )
  }

  async function enter(vault: VaultInfo): Promise<void> {
    set({
      vault,
      expanded: loadExpanded(vault.root),
      recentFiles: loadRecent(vault.root),
      selected: null,
      activeFile: null,
      slidesFile: null,
      summaryFile: null,
      lectureMode: false,
      renaming: null,
      recent: (await attempt(() => api.recent())) ?? get().recent
    })
    document.title = `${vault.name} - marginalia-poc`
    await get().refresh()
  }

  /** The folder the user is "in": the selected folder, or the folder of the selected or open page. */
  function currentFolder(): string | null {
    const { nodes, selected, activeFile } = get()
    const node = selected ? findNode(nodes, selected) : null
    if (node) return isFolder(node) ? node.path : parentOf(node.path)
    return activeFile ? parentOf(activeFile) : null
  }

  function expandAncestors(path: string): void {
    const parts = path.split('/').slice(0, -1)
    updateExpanded((e) => {
      const next = { ...e }
      parts.forEach((_, i) => (next[parts.slice(0, i + 1).join('/')] = true))
      return next
    })
  }

  /** First file of a kind in a folder, for pairing slides with a summary in lecture mode. */
  function firstIn(folder: string, kind: 'pdf' | 'markdown'): string | null {
    const children = folder ? (findNode(get().nodes, folder)?.children ?? []) : []
    return children.find((n) => n.kind === kind)?.path ?? null
  }

  /**
   * The note that goes with a PDF in lecture mode: the one linked before; else
   * "<pdf name>.md" next to it; else, when the PDF is alone in its folder, the note already
   * there; else a new "<pdf name>.md". The choice is remembered (in .marginalia/state.json).
   */
  /** Links a note to a PDF; the sidebar then shows it under that PDF. */
  async function link(pdf: string, note: string): Promise<void> {
    await attempt(() => api.setLinkedNote(pdf, note))
    if (get().links[pdf] !== note) set({ links: { ...get().links, [pdf]: note } })
  }

  async function noteFor(pdf: string): Promise<string | null> {
    const linked = await attempt(() => api.linkedNote(pdf))
    if (linked && findNode(get().nodes, linked)) return linked
    const folder = parentOf(pdf)
    if (!folder) return null
    const base = pdf
      .split('/')
      .pop()!
      .replace(/\.pdf$/i, '')
    const siblings = findNode(get().nodes, folder)?.children ?? []
    const sameName = siblings.find(
      (n) => n.kind === 'markdown' && n.name.toLowerCase() === `${base.toLowerCase()}.md`
    )
    const alone = siblings.filter((n) => n.kind === 'pdf').length === 1
    let note = sameName?.path ?? (alone ? firstIn(folder, 'markdown') : null)
    if (!note) {
      note = (await attempt(() => api.createNote(folder, base))) ?? null
      await get().refresh()
    }
    if (note) await link(pdf, note)
    return note
  }

  let errorTimer: ReturnType<typeof setTimeout> | undefined
  let gotoNonce = 0
  let initStarted = false

  return {
    vault: null,
    recent: [],
    ready: false,
    nodes: [],
    colors: {},
    links: {},
    expanded: {},
    selected: null,
    activeFile: null,
    slidesFile: null,
    summaryFile: null,
    lectureMode: false,
    pdfGoto: null,
    noteGoto: null,
    recentFiles: [],
    overlay: null,
    editor: null,
    snapshotting: false,
    renaming: null,
    error: null,
    notice: null,
    pdfView: null,
    pdfSelection: null,
    noteCursor: null,
    tool: 'select',
    settings: DEFAULT_SETTINGS,
    ink: {
      penColor: DEFAULT_SETTINGS.penColors[1],
      penWidth: PEN_WIDTHS[0].value,
      highlightColor: DEFAULT_SETTINGS.highlightColors[0],
      eraserMode: 'partial',
      eraserSize: ERASER_SIZES[1].value,
      textSize: TEXT_SIZES[1].value,
      textColor: null
    },

    async init() {
      // React's StrictMode runs effects twice in development.
      if (initStarted) return
      initStarted = true
      const settings = await attempt(() => window.api.settings.get())
      if (settings) {
        set({
          settings,
          ink: {
            ...get().ink,
            penColor: settings.penColors[1],
            highlightColor: settings.highlightColors[0]
          }
        })
      }
      const current = await attempt(() => api.current())
      const recent = (await attempt(() => api.recent())) ?? []
      set({ recent })
      // The last vault may have been moved or deleted; then the welcome screen shows.
      const vault = current ?? (recent[0] ? await api.open(recent[0]).catch(() => null) : null)
      if (vault) await enter(vault)
      set({ ready: true })
    },

    async openVault(root) {
      const vault = await attempt(() => (root ? api.open(root) : api.pick()))
      if (vault) await enter(vault)
    },

    async refresh() {
      const tree = await attempt(() => api.tree())
      if (!tree) return
      const { selected, activeFile, slidesFile, summaryFile, recentFiles } = get()
      const keep = (path: string | null): string | null =>
        path && findNode(tree.nodes, path) ? path : null
      set({
        recentFiles: recentFiles.filter((p) => findNode(tree.nodes, p)),
        nodes: tree.nodes,
        colors: tree.colors,
        links: tree.notes,
        selected: keep(selected),
        activeFile: keep(activeFile),
        slidesFile: keep(slidesFile),
        summaryFile: keep(summaryFile)
      })
    },

    select: (path) => set({ selected: path }),

    setExpanded: (path, open) => updateExpanded((e) => ({ ...e, [path]: open })),

    openFile(path, page, line) {
      const pdf = /\.pdf$/i.test(path)
      const { vault, recentFiles } = get()
      const recent = [path, ...recentFiles.filter((p) => p !== path)].slice(0, 20)
      if (vault) saveRecent(vault.root, recent)
      set({
        activeFile: path,
        selected: path,
        recentFiles: recent,
        ...(pdf ? { slidesFile: path } : { summaryFile: path }),
        ...(pdf && page ? { pdfGoto: { path, page, nonce: ++gotoNonce } } : {}),
        ...(!pdf && line ? { noteGoto: { path, line, nonce: ++gotoNonce } } : {})
      })
      expandAncestors(path)
    },

    async goTo(path, page, line) {
      const { lectureMode, slidesFile } = get()
      get().openFile(path, page, line)
      if (!lectureMode) return
      if (/\.pdf$/i.test(path)) {
        const note = await noteFor(path)
        if (note) set({ summaryFile: note })
      } else if (slidesFile) {
        await link(slidesFile, path)
      }
    },

    setOverlay: (overlay) => set({ overlay }),

    async toggleLecture() {
      if (get().lectureMode) {
        set({ lectureMode: false })
        return
      }
      const { activeFile, slidesFile: lastSlides } = get()
      let slidesFile: string | null = null
      let summaryFile: string | null = null
      // Start from what is on screen: slides bring their own note, a note finds its slides.
      if (activeFile?.toLowerCase().endsWith('.md')) {
        summaryFile = activeFile
        slidesFile =
          (await attempt(() => api.linkedPdf(activeFile))) ?? firstIn(parentOf(activeFile), 'pdf')
      } else {
        slidesFile = activeFile?.toLowerCase().endsWith('.pdf') ? activeFile : lastSlides
        if (slidesFile) summaryFile = await noteFor(slidesFile)
      }
      if (!slidesFile && !summaryFile) {
        get().showError('Open slides or a summary first')
        return
      }
      set({ lectureMode: true, slidesFile, summaryFile })
    },

    setEditor: (editor) => set({ editor }),
    startSnapshot() {
      const { editor, lectureMode, slidesFile, showError } = get()
      if (!editor || !lectureMode || !slidesFile) {
        showError('Open slides and a summary side by side (Ctrl+Shift+M) to take a snapshot')
        return
      }
      set({ snapshotting: true })
    },
    setSnapshotting: (snapshotting) => set({ snapshotting }),

    startRename: (path) => set({ renaming: path }),

    showError(message) {
      clearTimeout(errorTimer)
      set({ error: message, notice: null })
      if (message) errorTimer = setTimeout(() => set({ error: null }), 6000)
    },

    showNotice(message) {
      clearTimeout(errorTimer)
      set({ notice: message, error: null })
      if (message) errorTimer = setTimeout(() => set({ notice: null }), 6000)
    },

    async exportPdf(path) {
      await flushAll()
      const done = await attempt(() => api.exportPdf(path))
      if (!done) return
      const notes = [
        done.pdfChanged ? 'the PDF changed since you annotated it, so check the result' : '',
        done.skippedPages
          ? `${done.skippedPages} rotated ${done.skippedPages === 1 ? 'page was' : 'pages were'} copied without annotations`
          : '',
        done.missingImages
          ? `${done.missingImages} ${done.missingImages === 1 ? 'image was' : 'images were'} left out because the file is gone`
          : ''
      ].filter(Boolean)
      get().showNotice(
        `Exported to ${done.path}${notes.length ? `. Note: ${notes.join('; ')}.` : ''}`
      )
    },

    setPdfView: (view) => set({ pdfView: view }),
    setPdfSelection: (pdfSelection) => set({ pdfSelection }),
    setNoteCursor: (noteCursor) => set({ noteCursor }),
    setTool: (tool) => set({ tool }),
    setInk: (ink) => set({ ink: { ...get().ink, ...ink } }),

    async saveSettings(change) {
      // Show the change at once; the stored version (validated by main) replaces it after.
      set({ settings: { ...get().settings, ...change } })
      const settings = await attempt(() => window.api.settings.set(change))
      if (settings) set({ settings })
    },

    async importPdfs(sources, parent) {
      const target = parent ?? currentFolder()
      if (!target) {
        get().showError('Select a notebook or section to import into')
        return
      }
      const files = sources ?? (await attempt(() => api.pickPdfs()))
      if (!files?.length) return
      const imported = await attempt(() => api.importPdfs(target, files))
      if (!imported?.length) return
      await get().refresh()
      expandAncestors(imported[0])
      get().openFile(imported[0])
    },

    async create(item, parent) {
      const name = DEFAULT_NAMES[item]
      const path = await attempt(() =>
        item === 'page' ? api.createNote(parent, name) : api.createFolder(parent, name)
      )
      if (!path) return
      if (parent) get().setExpanded(parent, true)
      await get().refresh()
      set({ selected: path, renaming: path })
    },

    async rename(path, name) {
      set({ renaming: null })
      const node = findNode(get().nodes, path)
      if (!node || name.trim() === '' || name === node.name) return
      const to = await attempt(() => api.rename(path, name))
      if (!to) return
      followMove(path, to)
      await get().refresh()
    },

    async move(path, parent, before) {
      if (parentOf(path) === parent && before === undefined) return
      // Main takes a PDF's note along to another folder; open panes and selection follow it.
      const from = parentOf(path)
      const note =
        from !== parent
          ? pairNotes(childrenOf(get().nodes, from), get().links).get(path)
          : undefined
      const to = await attempt(() => api.move(path, parent, before))
      if (!to) return
      if (parent) get().setExpanded(parent, true)
      followMove(path, to)
      if (note) followMove(note.path, `${parent}/${note.name}`)
      await get().refresh()
    },

    async trash(path) {
      const done = await attempt(() => api.trash(path))
      if (done) await get().refresh()
    },

    async setColor(notebook, color) {
      await attempt(() => api.setColor(notebook, color))
      await get().refresh()
    }
  }
})
