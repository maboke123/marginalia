import { constants as fsConstants, promises as fs } from 'fs'
import path from 'path'
import type { AnnotationFile, LoadedAnnotations } from '../../shared/annotations'
import type { TranscribeLanguage } from '../../shared/settings'
import { noteLinks, pairNotes, withLink, withoutLink, type NoteLinks } from '../../shared/pairing'
import {
  TODO_NOTE,
  type LinkHow,
  type NotebookColor,
  type Position,
  type VaultNode,
  type VaultTree
} from '../../shared/types'
import { formatAnnotations, isAnnotationFile, sha256File } from './annotations'
import { renameWithRetry, tempPathFor, writeFileAtomic } from './atomic'
import {
  ASSETS_DIR,
  DATA_DIR,
  ORDER_FILE,
  SIDECAR_SUFFIX,
  VaultError,
  exists,
  isCodeDoc,
  isCodeFile,
  isHidden,
  resolveInVault,
  toRel,
  uniqueName,
  validateName
} from './names'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

interface Entry {
  name: string
  isDir: boolean
}

interface VaultSettings {
  /** Folder path -> colour name (a notebook's path is its name). */
  notebookColors?: Record<string, NotebookColor>
  /** Notebook path -> the language its lectures are given in. */
  courseLanguages?: Record<string, TranscribeLanguage>
  [key: string]: unknown
}

/** Positions that change often; kept apart from settings.json, which people may edit by hand. */
interface VaultState {
  lastPage?: Record<string, number>
  /** Section path -> Claude session id, so each lesson keeps its own conversation. */
  chats?: Record<string, string>
  /**
   * Folders and files left out of the sidebar, search and quick switcher (coding projects and
   * such). The name is older than hiding files.
   */
  hiddenFolders?: string[]
  /** PDF path -> its notes (`NoteLinks`); older files have one string per PDF. */
  notes?: Record<string, string | string[]>
  [key: string]: unknown
}

const within = (p: string, base: string): boolean => p === base || p.startsWith(base + '/')

/** Paths in a list after one moved; trashed ones (`to` null) are dropped. */
function remapList(list: string[] | undefined, from: string, to: string | null): string[] | null {
  if (!list?.some((p) => within(p, from))) return null
  return list.flatMap((p) =>
    within(p, from) ? (to === null ? [] : [to + p.slice(from.length)]) : [p]
  )
}

/** Note links after a PDF or note moved (or was trashed, with `to` null). */
function remapLinks(links: NoteLinks, from: string, to: string | null): NoteLinks | null {
  const byPdf = remapKeys(links, from, to) ?? links
  let changed = byPdf !== links
  const out: NoteLinks = {}
  for (const [pdf, notes] of Object.entries(byPdf)) {
    const next = notes.flatMap((n) =>
      within(n, from) ? (to === null ? [] : [to + n.slice(from.length)]) : [n]
    )
    if (next.some((n, i) => n !== notes[i]) || next.length !== notes.length) changed = true
    if (next.length) out[pdf] = next
  }
  return changed ? out : null
}

/** Re-keys entries for a path that moved (also everything below a moved folder); null drops them. */
function remapKeys<T>(
  map: Record<string, T> | undefined,
  from: string,
  to: string | null
): Record<string, T> | null {
  if (!map) return null
  let changed = false
  const out: Record<string, T> = {}
  for (const [p, value] of Object.entries(map)) {
    if (p !== from && !p.startsWith(from + '/')) out[p] = value
    else {
      changed = true
      if (to !== null) out[to + p.slice(from.length)] = value
    }
  }
  return changed ? out : null
}

const SETTINGS_FILE = 'settings.json'
const STATE_FILE = 'state.json'

/** Folders first, then natural order (B2 before B10). Names in `_order.json` come before the rest. */
export function sortEntries<T extends Entry>(entries: T[], order: string[] | null): T[] {
  const rank = new Map(order?.map((name, i) => [name, i]))
  return [...entries].sort((a, b) => {
    const ra = rank.get(a.name)
    const rb = rank.get(b.name)
    if (ra !== undefined || rb !== undefined) {
      if (ra === undefined) return 1
      if (rb === undefined) return -1
      return ra - rb
    }
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return collator.compare(a.name, b.name)
  })
}

async function readOrder(dir: string): Promise<string[] | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dir, ORDER_FILE), 'utf8'))
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'string') : null
  } catch {
    return null
  }
}

async function writeOrder(dir: string, names: string[]): Promise<void> {
  await writeFileAtomic(path.join(dir, ORDER_FILE), JSON.stringify(names, null, 2) + '\n')
}

async function updateOrder(dir: string, change: (names: string[]) => string[]): Promise<void> {
  const order = await readOrder(dir)
  if (order) await writeOrder(dir, change(order))
}

async function visibleEntries(dir: string): Promise<Entry[]> {
  const dirents = await fs.readdir(dir, { withFileTypes: true })
  const code = dirents.some((d) => d.isFile() && isCodeFile(d.name))
  const entries = dirents
    .filter((d) => (d.isDirectory() || d.isFile()) && !isHidden(d.name, d.isDirectory()))
    .filter((d) => !(code && d.isFile() && isCodeDoc(d.name)))
    .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
  return sortEntries(entries, await readOrder(dir))
}

const isPdf = (p: string): boolean => /\.pdf$/i.test(p)
const isMarkdown = (p: string): boolean => /\.md$/i.test(p)

const IMAGE_TYPES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])

/** 2026-10-02_14-31-05, the asset naming from SPEC section 4. */
export function timestamp(date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_` +
    `${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`
  )
}

export type TrashFn = (absPath: string) => Promise<void>

export class Vault {
  private dataQueue: Promise<unknown> = Promise.resolve()

  constructor(
    readonly root: string,
    private readonly trashItem: TrashFn
  ) {}

  resolve(rel: string): string {
    return resolveInVault(this.root, rel)
  }

  async tree(): Promise<VaultTree> {
    const [settings, state] = await Promise.all([
      this.readData<VaultSettings>(SETTINGS_FILE).catch((): VaultSettings => ({})),
      this.readState().catch((): VaultState => ({}))
    ])
    const notes = noteLinks(state.notes)
    const nodes = await this.readDir(this.root, 0, new Set(state.hiddenFolders), notes)
    return {
      nodes,
      colors: settings.notebookColors ?? {},
      notes,
      hidden: state.hiddenFolders ?? [],
      languages: settings.courseLanguages ?? {}
    }
  }

  async setCourseLanguage(notebook: string, language: TranscribeLanguage): Promise<void> {
    if (!notebook || notebook.includes('/')) throw new VaultError('Only a notebook has a language')
    if (language !== 'auto') await this.existingDir(notebook)
    await this.updateData<VaultSettings>(SETTINGS_FILE, (settings) => {
      const languages = { ...settings.courseLanguages }
      if (language === 'auto') delete languages[notebook]
      else languages[notebook] = language
      return { ...settings, courseLanguages: languages }
    })
  }

  /** Hides or shows a folder or a file. */
  async setHidden(rel: string, hidden: boolean): Promise<void> {
    if (hidden && !(await exists(this.resolveItem(rel)))) {
      throw new VaultError(`"${rel}" does not exist`)
    }
    return this.updateData<VaultState>(STATE_FILE, (state) => {
      const current = state.hiddenFolders ?? []
      if (current.includes(rel) === hidden) return null
      const hiddenFolders = hidden ? [...current, rel].sort() : current.filter((f) => f !== rel)
      return { ...state, hiddenFolders }
    })
  }

  private async readDir(
    dir: string,
    depth: number,
    hidden = new Set<string>(),
    links: NoteLinks = {}
  ): Promise<VaultNode[]> {
    let entries: Entry[]
    try {
      entries = await visibleEntries(dir)
    } catch (err) {
      // A folder can disappear between listing its parent and reading it.
      if (depth > 0 && (err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    const relOf = (name: string): string => toRel(this.root, path.join(dir, name))
    const files = entries
      .filter((e) => !e.isDir)
      .map(({ name }): VaultNode => ({
        name,
        path: relOf(name),
        kind: isPdf(name) ? 'pdf' : 'markdown'
      }))
    // The notes shown under a hidden PDF go with it.
    const gone = new Set(hidden)
    for (const [pdf, notes] of pairNotes(files, links)) {
      if (hidden.has(pdf)) for (const note of notes) gone.add(note.path)
    }
    const shown = entries.filter(({ name }) => !gone.has(relOf(name)))
    return Promise.all(
      shown.map(async ({ name, isDir }): Promise<VaultNode> => {
        const abs = path.join(dir, name)
        const rel = toRel(this.root, abs)
        if (!isDir) return { name, path: rel, kind: isPdf(name) ? 'pdf' : 'markdown' }
        return {
          name,
          path: rel,
          kind: depth === 0 ? 'notebook' : 'section',
          children: await this.readDir(abs, depth + 1, hidden, links)
        }
      })
    )
  }

  async createFolder(parentRel: string, name: string): Promise<string> {
    const parent = await this.existingDir(parentRel)
    const target = path.join(parent, await uniqueName(parent, validateName(name)))
    await fs.mkdir(target)
    return toRel(this.root, target)
  }

  async createNote(parentRel: string, name: string): Promise<string> {
    if (!parentRel) throw new VaultError('Pages go inside a notebook or section')
    const parent = await this.existingDir(parentRel)
    const base = validateName(name).replace(/\.md$/i, '')
    const target = path.join(parent, await uniqueName(parent, base, '.md'))
    await fs.writeFile(target, '', { flag: 'wx' })
    return toRel(this.root, target)
  }

  /** The one note at the vault root, for thoughts and things to do across courses. */
  async ensureTodo(): Promise<string> {
    await fs.writeFile(this.resolve(TODO_NOTE), '# Todo\n\n', { flag: 'wx' }).catch((err) => {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    })
    return TODO_NOTE
  }

  /** Adds text to the end of a note, for transcripts written while a lecture goes on. */
  async appendText(rel: string, text: string): Promise<void> {
    const current = await this.readText(rel)
    await this.writeText(rel, current + text)
  }

  /** Adds bytes to the end of a file in the assets folder next to `nearRel` (a recording). */
  async appendAsset(nearRel: string, name: string, data: Uint8Array): Promise<string> {
    if (!/^[\w.-]+$/.test(name)) throw new VaultError(`Bad asset name: ${name}`)
    const dir = path.join(path.dirname(this.resolveItem(nearRel)), ASSETS_DIR)
    await fs.mkdir(dir, { recursive: true })
    await fs.appendFile(path.join(dir, name), data)
    return `${ASSETS_DIR}/${name}`
  }

  /** Reads a small text file of the app's own from the assets folder next to `nearRel`. */
  async readAsset(nearRel: string, name: string): Promise<string> {
    if (!/^[\w.-]+$/.test(name)) throw new VaultError(`Bad asset name: ${name}`)
    const dir = path.join(path.dirname(this.resolveItem(nearRel)), ASSETS_DIR)
    return fs.readFile(path.join(dir, name), 'utf8')
  }

  /** Writes (replaces) a small file of the app's own in the assets folder next to `nearRel`. */
  async writeAsset(nearRel: string, name: string, text: string): Promise<string> {
    if (!/^[\w.-]+$/.test(name)) throw new VaultError(`Bad asset name: ${name}`)
    const dir = path.join(path.dirname(this.resolveItem(nearRel)), ASSETS_DIR)
    await fs.mkdir(dir, { recursive: true })
    await writeFileAtomic(path.join(dir, name), text)
    return `${ASSETS_DIR}/${name}`
  }

  /** Copies a file from outside into the assets folder next to `nearRel`, never overwriting. */
  async copyAsset(nearRel: string, name: string, source: string): Promise<string> {
    if (!/^[\w.-]+$/.test(name)) throw new VaultError(`Bad asset name: ${name}`)
    const dir = path.join(path.dirname(this.resolveItem(nearRel)), ASSETS_DIR)
    await fs.mkdir(dir, { recursive: true })
    await fs.copyFile(source, path.join(dir, name), fsConstants.COPYFILE_EXCL)
    return `${ASSETS_DIR}/${name}`
  }

  /** Copies a PDF into a section. The original is only read, never moved or changed. */
  async importPdf(parentRel: string, source: string): Promise<string> {
    if (!parentRel) throw new VaultError('PDFs go inside a notebook or section')
    if (!isPdf(source)) throw new VaultError(`"${path.basename(source)}" is not a PDF`)
    const stat = await fs.stat(source).catch(() => null)
    if (!stat?.isFile()) throw new VaultError(`File not found: ${source}`)
    const parent = await this.existingDir(parentRel)

    const base = path.basename(source, path.extname(source))
    // An orphaned sidecar would otherwise attach old annotations to the new PDF.
    const name = await uniqueName(parent, base, '.pdf', [SIDECAR_SUFFIX])
    const target = path.join(parent, name)
    const tmp = tempPathFor(target)
    await fs.copyFile(source, tmp, fsConstants.COPYFILE_EXCL)
    try {
      await renameWithRetry(tmp, target)
    } catch (err) {
      await fs.rm(tmp, { force: true })
      throw err
    }
    return toRel(this.root, target)
  }

  async readText(rel: string): Promise<string> {
    const abs = this.resolveItem(rel)
    if (!isMarkdown(abs)) throw new VaultError(`"${rel}" is not a Markdown file`)
    return fs.readFile(abs, 'utf8').catch(() => {
      throw new VaultError(`"${rel}" does not exist`)
    })
  }

  async writeText(rel: string, text: string): Promise<void> {
    const abs = this.resolveItem(rel)
    if (!isMarkdown(abs)) throw new VaultError(`"${rel}" is not a Markdown file`)
    // Refuse to resurrect a note that was deleted or moved while it was open.
    if (!(await exists(abs))) throw new VaultError(`"${rel}" no longer exists`)
    await writeFileAtomic(abs, text)
  }

  /**
   * Stores an image in the assets folder next to a note, named after the current time.
   * Returns the path to put in the note's Markdown, relative to the note.
   */
  async saveAsset(noteRel: string, data: Uint8Array, extension: string): Promise<string> {
    const note = this.resolveItem(noteRel)
    const ext = extension.toLowerCase().replace(/^\./, '')
    if (!IMAGE_TYPES.has(ext)) throw new VaultError(`.${ext} files are not images`)
    const dir = path.join(path.dirname(note), ASSETS_DIR)
    await fs.mkdir(dir, { recursive: true })
    const stamp = timestamp()
    for (let n = 1; ; n++) {
      const name = n === 1 ? `${stamp}.${ext}` : `${stamp}-${n}.${ext}`
      try {
        await fs.writeFile(path.join(dir, name), data, { flag: 'wx' })
        return `${ASSETS_DIR}/${name}`
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      }
    }
  }

  async readFile(rel: string): Promise<Uint8Array> {
    const abs = this.resolveItem(rel)
    const stat = await fs.stat(abs).catch(() => null)
    if (!stat?.isFile()) throw new VaultError(`"${rel}" does not exist`)
    return fs.readFile(abs)
  }

  async readAnnotations(rel: string): Promise<LoadedAnnotations> {
    const abs = await this.existingPdf(rel)
    const [pdfSha256, text] = await Promise.all([
      sha256File(abs),
      fs.readFile(abs + SIDECAR_SUFFIX, 'utf8').catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return null
        throw err
      })
    ])
    if (text === null) return { file: null, pdfSha256 }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
    // The app then shows the PDF read-only, so the file is never overwritten.
    if (!isAnnotationFile(parsed)) {
      throw new VaultError(
        `${path.basename(abs)}${SIDECAR_SUFFIX} is damaged, so annotations are off`
      )
    }
    return { file: parsed, pdfSha256 }
  }

  async writeAnnotations(rel: string, file: AnnotationFile): Promise<void> {
    const abs = await this.existingPdf(rel)
    if (!isAnnotationFile(file)) throw new VaultError('Refusing to save invalid annotations')
    await writeFileAtomic(abs + SIDECAR_SUFFIX, formatAnnotations(file) + '\n')
  }

  async lastPage(rel: string): Promise<number | null> {
    const state = await this.readState()
    return state.lastPage?.[toRel(this.root, this.resolveItem(rel))] ?? null
  }

  setLastPage(rel: string, page: number): Promise<void> {
    const key = toRel(this.root, this.resolveItem(rel))
    return this.updateData<VaultState>(STATE_FILE, (state) =>
      state.lastPage?.[key] === page
        ? null
        : { ...state, lastPage: { ...state.lastPage, [key]: page } }
    )
  }

  async chatSession(section: string): Promise<string | null> {
    const state = await this.readState()
    return state.chats?.[section] ?? null
  }

  setChatSession(section: string, sessionId: string | null): Promise<void> {
    return this.updateData<VaultState>(STATE_FILE, (state) => {
      if ((state.chats?.[section] ?? null) === sessionId) return null
      const chats = { ...state.chats }
      if (sessionId) chats[section] = sessionId
      else delete chats[section]
      return { ...state, chats }
    })
  }

  /** The note lecture mode opens for a PDF: the first linked one that still exists. */
  async linkedNote(pdf: string): Promise<string | null> {
    const state = await this.readState()
    for (const note of noteLinks(state.notes)[pdf] ?? []) {
      if (await exists(this.resolve(note))) return note
    }
    return null
  }

  /** The PDF a note is linked to, if any. */
  async linkedPdf(note: string): Promise<string | null> {
    const state = await this.readState()
    for (const [pdf, linked] of Object.entries(noteLinks(state.notes))) {
      if (linked.includes(note) && (await exists(this.resolve(pdf)))) return pdf
    }
    return null
  }

  linkNote(pdf: string, note: string, how: LinkHow): Promise<void> {
    return this.updateData<VaultState>(STATE_FILE, (state) => {
      const links = noteLinks(state.notes)
      const next =
        how === 'remove'
          ? withoutLink(links, pdf, note)
          : withLink(links, pdf, note, how === 'current')
      // Unchanged links still rewrite once when the file has the old one-string form.
      if (next === links && JSON.stringify(links) === JSON.stringify(state.notes ?? {})) return null
      return { ...state, notes: next }
    })
  }

  async rename(rel: string, newName: string): Promise<string> {
    const abs = this.resolveItem(rel)
    const isDir = (await fs.stat(abs)).isDirectory()
    const oldName = path.basename(abs)
    let name = validateName(newName)
    if (!isDir) {
      const ext = path.extname(oldName)
      if (!name.toLowerCase().endsWith(ext.toLowerCase())) name += ext
    }
    const dir = path.dirname(abs)
    const target = path.join(dir, name)
    // A note paired with the PDF by its name keeps that name; a note linked under another
    // name keeps its own (the link follows the rename).
    const stem = (n: string): string => n.replace(/\.(md|pdf)$/i, '')
    const paired = !isDir && isPdf(abs) ? await this.pairedNotes(abs) : []
    const note =
      paired.find((n) => stem(path.basename(n)).toLowerCase() === stem(oldName).toLowerCase()) ??
      null
    const noteTarget = note && path.join(dir, `${stem(name)}.md`)
    const caseOnly = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
    if (note && noteTarget && !caseOnly(note, noteTarget) && (await exists(noteTarget))) {
      throw new VaultError(`"${path.basename(noteTarget)}" already exists`)
    }
    await this.moveEntry(abs, target, isDir)
    if (note && noteTarget) {
      try {
        await this.moveEntry(note, noteTarget, false)
      } catch (err) {
        await this.moveEntry(target, abs, false)
        throw err
      }
    }
    const renamed = new Map([[oldName, name]])
    if (note && noteTarget) renamed.set(path.basename(note), path.basename(noteTarget))
    await updateOrder(dir, (names) => names.map((n) => renamed.get(n) ?? n))
    if (isDir) await this.remapColors(toRel(this.root, abs), toRel(this.root, target))
    await this.remapState(toRel(this.root, abs), toRel(this.root, target))
    if (note && noteTarget) {
      await this.remapState(toRel(this.root, note), toRel(this.root, noteTarget))
    }
    return toRel(this.root, target)
  }

  async move(rel: string, parentRel: string, before?: Position): Promise<string> {
    const abs = this.resolveItem(rel)
    const parent = await this.existingDir(parentRel)
    const isDir = (await fs.stat(abs)).isDirectory()
    if (!isDir && parent === this.root) {
      throw new VaultError('Pages go inside a notebook or section')
    }
    if (isDir && (parent === abs || parent.startsWith(abs + path.sep))) {
      throw new VaultError('A folder cannot be moved into itself')
    }

    const name = path.basename(abs)
    const oldParent = path.dirname(abs)
    const target = path.join(parent, name)
    // A PDF's notes go with it to another folder, so what the sidebar shows stays together.
    const notes = !isDir && isPdf(abs) && oldParent !== parent ? await this.pairedNotes(abs) : []
    const noteMoves = notes.map((note) => [note, path.join(parent, path.basename(note))])
    for (const [, noteTarget] of noteMoves) {
      if (await exists(noteTarget)) {
        throw new VaultError(`"${path.basename(noteTarget)}" already exists there`)
      }
    }
    if (target !== abs) {
      await this.moveEntry(abs, target, isDir)
      const moved: string[][] = []
      try {
        for (const [note, noteTarget] of noteMoves) {
          await this.moveEntry(note, noteTarget, false)
          moved.push([note, noteTarget])
        }
      } catch (err) {
        for (const [note, noteTarget] of moved.reverse()) {
          await this.moveEntry(noteTarget, note, false)
        }
        await this.moveEntry(target, abs, false)
        throw err
      }
      const gone = new Set([name, ...notes.map((n) => path.basename(n))])
      await updateOrder(oldParent, (names) => names.filter((n) => !gone.has(n)))
      if (isDir) await this.remapColors(toRel(this.root, abs), toRel(this.root, target))
      await this.remapState(toRel(this.root, abs), toRel(this.root, target))
      for (const [note, noteTarget] of noteMoves) {
        await this.remapState(toRel(this.root, note), toRel(this.root, noteTarget))
      }
    }

    if (before !== undefined) {
      const names = (await visibleEntries(parent)).map((e) => e.name).filter((n) => n !== name)
      const index = before === null ? -1 : names.indexOf(before)
      names.splice(index === -1 ? names.length : index, 0, name)
      await writeOrder(parent, names)
    }
    return toRel(this.root, target)
  }

  async trash(rel: string): Promise<void> {
    const abs = this.resolveItem(rel)
    const isDir = (await fs.stat(abs)).isDirectory()
    const name = path.basename(abs)
    const parent = path.dirname(abs)
    await this.trashItem(abs)
    if (!isDir && isPdf(abs) && (await exists(abs + SIDECAR_SUFFIX))) {
      await this.trashItem(abs + SIDECAR_SUFFIX)
    }
    await updateOrder(parent, (names) => names.filter((n) => n !== name))
    if (isDir) await this.remapColors(toRel(this.root, abs), null)
    await this.remapState(toRel(this.root, abs), null)
  }

  async setColor(folder: string, color: NotebookColor | null): Promise<void> {
    const abs = await this.existingDir(folder)
    if (abs === this.root) throw new VaultError('The vault itself cannot have a colour')
    const rel = toRel(this.root, abs)
    await this.updateData<VaultSettings>(SETTINGS_FILE, (settings) => {
      const colors = { ...settings.notebookColors }
      if (color) colors[rel] = color
      else delete colors[rel]
      return { ...settings, notebookColors: colors }
    })
  }

  /** Moves a file or folder without ever overwriting. A PDF takes its annotation sidecar along. */
  private async moveEntry(from: string, to: string, isDir: boolean): Promise<void> {
    if (from === to) return
    // NTFS is case-insensitive, so renaming "trees" to "Trees" finds itself as "existing".
    const caseOnly = from.toLowerCase() === to.toLowerCase()
    const hasSidecar = !isDir && isPdf(from) && (await exists(from + SIDECAR_SUFFIX))
    if (!caseOnly) {
      if (await exists(to)) throw new VaultError(`"${path.basename(to)}" already exists there`)
      if (hasSidecar && (await exists(to + SIDECAR_SUFFIX))) {
        throw new VaultError(`"${path.basename(to)}${SIDECAR_SUFFIX}" already exists there`)
      }
    }

    await renameWithRetry(from, to)
    if (hasSidecar) {
      try {
        await renameWithRetry(from + SIDECAR_SUFFIX, to + SIDECAR_SUFFIX)
      } catch (err) {
        await renameWithRetry(to, from)
        throw err
      }
    }
    if (!isDir && path.dirname(from) !== path.dirname(to)) {
      // The move itself worked; a missing image shows as such and the old copy stays.
      const copied = hasSidecar
        ? this.copyPageImages(path.dirname(from), to)
        : isMarkdown(to)
          ? this.copyNoteImages(path.dirname(from), to)
          : null
      await copied?.catch(console.error)
    }
  }

  /** The notes the sidebar shows under this PDF (`pairNotes`). */
  private async pairedNotes(pdf: string): Promise<string[]> {
    const dir = path.dirname(pdf)
    const files = (await visibleEntries(dir))
      .filter((e) => !e.isDir)
      .map((e) => ({
        name: e.name,
        path: toRel(this.root, path.join(dir, e.name)),
        kind: isPdf(e.name) ? ('pdf' as const) : ('markdown' as const)
      }))
    const state = await this.readState()
    const notes = pairNotes(files, noteLinks(state.notes)).get(toRel(this.root, pdf)) ?? []
    return notes.map((n) => this.resolve(n.path))
  }

  /**
   * Copies images from `oldDir`'s assets folder to `newDir`'s; the originals stay, nothing is
   * ever removed. A different file with the same name there gets a new name, returned as
   * old src -> new src so the referring file can follow.
   */
  private async copyAssets(
    oldDir: string,
    newDir: string,
    sources: Iterable<string>
  ): Promise<Map<string, string>> {
    const renamed = new Map<string, string>()
    for (const src of sources) {
      if (!new RegExp(`^${ASSETS_DIR}/[^/\\\\]+$`).test(src)) continue
      const data = await fs.readFile(path.join(oldDir, src)).catch(() => null)
      if (!data) continue
      const ext = path.extname(src)
      const base = src.slice(0, -ext.length || undefined)
      await fs.mkdir(path.join(newDir, ASSETS_DIR), { recursive: true })
      for (let n = 1; ; n++) {
        const name = n === 1 ? src : `${base}-${n}${ext}`
        const target = path.join(newDir, name)
        const existing = await fs.readFile(target).catch(() => null)
        if (existing && Buffer.compare(existing, data) === 0) {
          if (name !== src) renamed.set(src, name)
          break
        }
        if (existing) continue
        await fs.writeFile(target, data, { flag: 'wx' })
        if (name !== src) renamed.set(src, name)
        break
      }
    }
    return renamed
  }

  /** After a PDF moved to another folder, the images on its pages follow it. */
  private async copyPageImages(oldDir: string, pdf: string): Promise<void> {
    const file: unknown = JSON.parse(await fs.readFile(pdf + SIDECAR_SUFFIX, 'utf8'))
    if (!isAnnotationFile(file)) return
    const sources = new Set(
      Object.values(file.pages).flatMap((p) => (p.images ?? []).map((im) => im.src))
    )
    const renamed = await this.copyAssets(oldDir, path.dirname(pdf), sources)
    if (!renamed.size) return
    for (const p of Object.values(file.pages)) {
      p.images = p.images?.map((im) => ({ ...im, src: renamed.get(im.src) ?? im.src }))
    }
    await writeFileAtomic(pdf + SIDECAR_SUFFIX, formatAnnotations(file) + '\n')
  }

  /** After a note moved to another folder, the images it links to in assets/ follow it. */
  private async copyNoteImages(oldDir: string, note: string): Promise<void> {
    const text = await fs.readFile(note, 'utf8')
    // ![](assets/x.png), possibly URL-encoded, and ![](<assets/x y.png>).
    const link = new RegExp(
      `\\]\\((?:(<)(${ASSETS_DIR}/[^>\\n]+)(>)|()(${ASSETS_DIR}/[^)\\s]+)())\\)`,
      'g'
    )
    const decode = (raw: string): string => {
      try {
        return decodeURIComponent(raw)
      } catch {
        return raw
      }
    }
    const sources = new Set([...text.matchAll(link)].map((m) => decode(m[2] ?? m[5])))
    const renamed = await this.copyAssets(oldDir, path.dirname(note), sources)
    if (!renamed.size) return
    const next = text.replace(link, (whole, ...groups: (string | undefined)[]) => {
      const [open, raw, close] = groups[1] !== undefined ? groups.slice(0, 3) : groups.slice(3, 6)
      const to = renamed.get(decode(raw!))
      if (!to) return whole
      // Inside <...> a name may have spaces; a bare link needs them encoded.
      const href = open ? to : to.split('/').map(encodeURIComponent).join('/')
      return `](${open}${href}${close})`
    })
    await writeFileAtomic(note, next)
  }

  private async existingPdf(rel: string): Promise<string> {
    const abs = this.resolveItem(rel)
    const stat = await fs.stat(abs).catch(() => null)
    if (!isPdf(abs) || !stat?.isFile()) throw new VaultError(`"${rel}" is not a PDF in this vault`)
    return abs
  }

  private resolveItem(rel: string): string {
    if (!rel) throw new VaultError('The vault itself cannot be changed')
    return this.resolve(rel)
  }

  private async existingDir(rel: string): Promise<string> {
    const abs = this.resolve(rel)
    const stat = await fs.stat(abs).catch(() => null)
    if (!stat?.isDirectory()) throw new VaultError(`Folder "${rel}" does not exist`)
    return abs
  }

  /** Folder colours follow a folder and its subfolders when it is renamed, moved or trashed. */
  private remapColors(from: string, to: string | null): Promise<void> {
    return this.updateData<VaultSettings>(SETTINGS_FILE, (settings) => {
      const colors = remapKeys(settings.notebookColors, from, to)
      // A notebook moved into another one is a section now, without a language of its own.
      const languages = remapKeys(settings.courseLanguages, from, to?.includes('/') ? null : to)
      if (!colors && !languages) return null
      return {
        ...settings,
        ...(colors && { notebookColors: colors }),
        ...(languages && { courseLanguages: languages })
      }
    })
  }

  /**
   * Keeps remembered pages, conversations and PDF-note links attached to files and sections
   * that were renamed, moved (also via a parent folder) or trashed.
   */
  private remapState(from: string, to: string | null): Promise<void> {
    return this.updateData<VaultState>(STATE_FILE, (state) => {
      const lastPage = remapKeys(state.lastPage, from, to)
      const chats = remapKeys(state.chats, from, to)
      // Links between PDFs and notes follow whichever side moved.
      const notes = remapLinks(noteLinks(state.notes), from, to)
      const hiddenFolders = remapList(state.hiddenFolders, from, to)
      if (!lastPage && !chats && !notes && !hiddenFolders) return null
      return {
        ...state,
        ...(lastPage && { lastPage }),
        ...(chats && { chats }),
        ...(notes && { notes }),
        ...(hiddenFolders && { hiddenFolders })
      }
    })
  }

  /**
   * state.json after any write still in the queue, so a page saved a moment ago is read back
   * (lecture mode reopens a PDF right after the old viewer saved its page).
   */
  private async readState(): Promise<VaultState> {
    await this.dataQueue
    return this.readData<VaultState>(STATE_FILE)
  }

  private async readData<T extends object>(file: string): Promise<T> {
    let text: string
    try {
      text = await fs.readFile(path.join(this.root, DATA_DIR, file), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {} as T
      throw err
    }
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {
      // fall through
    }
    // Refuse to continue rather than overwrite a file someone may have edited by hand.
    throw new VaultError(`${DATA_DIR}/${file} is not valid JSON`)
  }

  /**
   * Read-modify-write of a file in .marginalia. Runs one at a time so two quick updates
   * (say a rename and a page change) cannot overwrite each other. Returning null skips the write.
   */
  private updateData<T extends object>(file: string, change: (data: T) => T | null): Promise<void> {
    const run = this.dataQueue.then(async () => {
      const next = change(await this.readData<T>(file))
      if (!next) return
      await fs.mkdir(path.join(this.root, DATA_DIR), { recursive: true })
      const text = JSON.stringify(next, null, 2) + '\n'
      await writeFileAtomic(path.join(this.root, DATA_DIR, file), text)
    })
    this.dataQueue = run.catch(() => undefined)
    return run
  }
}
