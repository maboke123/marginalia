import { promises as fs } from 'fs'
import path from 'path'
import { fold } from '../../shared/text'
import { blankColorTags } from '../../shared/textColor'
import type { PdfToIndex, SearchHit, SearchResult, VaultNode } from '../../shared/types'
import { writeFileAtomic } from '../vault/atomic'
import type { Vault } from '../vault/vault'
import { matchAt, paragraphs, snippet, terms } from './match'

interface PdfEntry {
  stamp: string
  pages: string[]
  folded: string[]
}

interface NoteEntry {
  stamp: string
  text: string
  folded: string
}

interface CacheFile {
  version: 1
  pdfs: Record<string, { stamp: string; pages: string[] }>
}

const MAX_HITS = 200
const MAX_HITS_PER_FILE = 25

function files(nodes: VaultNode[], out: VaultNode[] = []): VaultNode[] {
  for (const node of nodes) {
    if (node.children) files(node.children, out)
    else out.push(node)
  }
  return out
}

/**
 * Full-text search over notes and slides. PDF text is extracted by the renderer (pdf.js runs
 * there, in a worker) and cached in a file outside the vault, so it is not synced around.
 * Notes are read from disk when they changed. Text is folded once, so a query only scans.
 */
export class SearchIndex {
  private pdfs = new Map<string, PdfEntry>()
  private notes = new Map<string, NoteEntry>()
  private loaded: Promise<void>
  private saveTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly vault: Vault,
    private readonly cacheFile: string
  ) {
    this.loaded = this.load()
  }

  /** PDFs whose text is missing or out of date. Also forgets PDFs that are gone. */
  async pending(): Promise<PdfToIndex[]> {
    await this.loaded
    const all = await this.stampedFiles()
    const pdfs = all.filter((f) => f.kind === 'pdf')
    const present = new Set(pdfs.map((f) => f.path))
    let removed = false
    for (const key of this.pdfs.keys()) {
      if (!present.has(key)) removed = this.pdfs.delete(key)
    }
    if (removed) this.scheduleSave()
    return pdfs
      .filter((f) => this.pdfs.get(f.path)?.stamp !== f.stamp)
      .map(({ path, stamp }) => ({ path, stamp }))
  }

  async storePdf(rel: string, stamp: string, pages: string[]): Promise<void> {
    await this.loaded
    this.pdfs.set(rel, { stamp, pages, folded: pages.map(fold) })
    this.scheduleSave()
  }

  async query(query: string): Promise<SearchResult> {
    await this.loaded
    const words = terms(query)
    const all = await this.stampedFiles()
    const hits: SearchHit[] = []
    let truncated = false
    let unindexed = 0
    const add = (hit: SearchHit): boolean => {
      if (hits.length >= MAX_HITS) {
        truncated = true
        return false
      }
      hits.push(hit)
      return true
    }

    // Notes first: they are my own words, usually what I am looking for.
    for (const file of all.filter((f) => f.kind === 'markdown')) {
      const note = await this.note(file.path, file.stamp)
      if (!note || !words.length) continue
      let count = 0
      for (const p of paragraphs(note.text)) {
        const at = matchAt(note.folded.slice(p.from, p.to), words)
        if (at === null) continue
        if (++count > MAX_HITS_PER_FILE) break
        const before = note.text.slice(p.from, p.from + at).split('\n').length - 1
        const text = note.text.slice(p.from, p.to)
        const hit = snippet(text, note.folded.slice(p.from, p.to), words, at)
        if (!add({ path: file.path, kind: 'markdown', line: p.line + before, ...hit })) break
      }
    }

    for (const file of all.filter((f) => f.kind === 'pdf')) {
      const pdf = this.pdfs.get(file.path)
      if (!pdf || pdf.stamp !== file.stamp) unindexed++
      if (!pdf || !words.length) continue
      let count = 0
      for (let i = 0; i < pdf.pages.length; i++) {
        const at = matchAt(pdf.folded[i], words)
        if (at === null) continue
        if (++count > MAX_HITS_PER_FILE) break
        const hit = snippet(pdf.pages[i], pdf.folded[i], words, at)
        if (!add({ path: file.path, kind: 'pdf', page: i + 1, ...hit })) break
      }
    }
    return { hits, truncated, unindexed }
  }

  /** Writes a pending cache update now (when the window closes). */
  async flush(): Promise<void> {
    if (!this.saveTimer) return
    clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    await this.save()
  }

  private async note(rel: string, stamp: string): Promise<NoteEntry | null> {
    const cached = this.notes.get(rel)
    if (cached?.stamp === stamp) return cached
    try {
      // Without the colour tags, "red" finds red things rather than every coloured word.
      const text = blankColorTags(await fs.readFile(this.vault.resolve(rel), 'utf8'))
      const entry = { stamp, text, folded: fold(text) }
      this.notes.set(rel, entry)
      return entry
    } catch {
      return null
    }
  }

  private async stampedFiles(): Promise<{ path: string; kind: string; stamp: string }[]> {
    const { nodes } = await this.vault.tree()
    const stamped = await Promise.all(
      files(nodes).map(async (node) => {
        const stat = await fs.stat(this.vault.resolve(node.path)).catch(() => null)
        return stat && { path: node.path, kind: node.kind, stamp: `${stat.mtimeMs}-${stat.size}` }
      })
    )
    return stamped.filter((f) => f !== null)
  }

  private async load(): Promise<void> {
    try {
      const cache = JSON.parse(await fs.readFile(this.cacheFile, 'utf8')) as CacheFile
      if (cache.version !== 1) return
      for (const [rel, { stamp, pages }] of Object.entries(cache.pdfs)) {
        this.pdfs.set(rel, { stamp, pages, folded: pages.map(fold) })
      }
    } catch {
      // No cache yet, or a damaged one: the renderer indexes the PDFs again.
    }
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      this.save().catch((err) => console.error('[search] cache not saved', err))
    }, 2000)
  }

  private async save(): Promise<void> {
    const cache: CacheFile = { version: 1, pdfs: {} }
    for (const [rel, { stamp, pages }] of this.pdfs) cache.pdfs[rel] = { stamp, pages }
    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true })
    await writeFileAtomic(this.cacheFile, JSON.stringify(cache))
  }
}
