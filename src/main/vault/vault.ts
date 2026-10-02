import { promises as fs } from 'fs'
import path from 'path'
import type { NotebookColor, Position, VaultNode, VaultTree } from '../../shared/types'
import { renameWithRetry, writeFileAtomic } from './atomic'
import {
  DATA_DIR,
  ORDER_FILE,
  SIDECAR_SUFFIX,
  VaultError,
  exists,
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
  notebookColors?: Record<string, NotebookColor>
  [key: string]: unknown
}

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
  const entries = dirents
    .filter((d) => (d.isDirectory() || d.isFile()) && !isHidden(d.name, d.isDirectory()))
    .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
  return sortEntries(entries, await readOrder(dir))
}

const isPdf = (p: string): boolean => /\.pdf$/i.test(p)

export type TrashFn = (absPath: string) => Promise<void>

export class Vault {
  constructor(
    readonly root: string,
    private readonly trashItem: TrashFn
  ) {}

  resolve(rel: string): string {
    return resolveInVault(this.root, rel)
  }

  async tree(): Promise<VaultTree> {
    const [nodes, settings] = await Promise.all([
      this.readDir(this.root, 0),
      this.readSettings().catch((): VaultSettings => ({}))
    ])
    return { nodes, colors: settings.notebookColors ?? {} }
  }

  private async readDir(dir: string, depth: number): Promise<VaultNode[]> {
    let entries: Entry[]
    try {
      entries = await visibleEntries(dir)
    } catch (err) {
      // A folder can disappear between listing its parent and reading it.
      if (depth > 0 && (err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    return Promise.all(
      entries.map(async ({ name, isDir }): Promise<VaultNode> => {
        const abs = path.join(dir, name)
        const rel = toRel(this.root, abs)
        if (!isDir) return { name, path: rel, kind: isPdf(name) ? 'pdf' : 'markdown' }
        return {
          name,
          path: rel,
          kind: depth === 0 ? 'notebook' : 'section',
          children: await this.readDir(abs, depth + 1)
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
    await this.moveEntry(abs, target, isDir)
    await updateOrder(dir, (names) => names.map((n) => (n === oldName ? name : n)))
    if (isDir && dir === this.root) await this.renameColor(oldName, name)
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
    if (target !== abs) {
      await this.moveEntry(abs, target, isDir)
      await updateOrder(oldParent, (names) => names.filter((n) => n !== name))
      if (isDir && oldParent === this.root) await this.renameColor(name, null)
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
    if (isDir && parent === this.root) await this.renameColor(name, null)
  }

  async setColor(notebook: string, color: NotebookColor | null): Promise<void> {
    const abs = await this.existingDir(notebook)
    if (path.dirname(abs) !== this.root) throw new VaultError('Only notebooks have a colour')
    const settings = await this.readSettings()
    const colors = { ...settings.notebookColors }
    const name = path.basename(abs)
    if (color) colors[name] = color
    else delete colors[name]
    await this.writeSettings({ ...settings, notebookColors: colors })
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
    if (!hasSidecar) return
    try {
      await renameWithRetry(from + SIDECAR_SUFFIX, to + SIDECAR_SUFFIX)
    } catch (err) {
      await renameWithRetry(to, from)
      throw err
    }
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

  private async renameColor(oldName: string, newName: string | null): Promise<void> {
    const settings = await this.readSettings()
    const color = settings.notebookColors?.[oldName]
    if (!color) return
    const colors = { ...settings.notebookColors }
    delete colors[oldName]
    if (newName) colors[newName] = color
    await this.writeSettings({ ...settings, notebookColors: colors })
  }

  private async readSettings(): Promise<VaultSettings> {
    let text: string
    try {
      text = await fs.readFile(this.settingsPath(), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw err
    }
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {
      // fall through
    }
    // Refuse to continue rather than overwrite a file someone may have edited by hand.
    throw new VaultError(`${DATA_DIR}/settings.json is not valid JSON`)
  }

  private async writeSettings(settings: VaultSettings): Promise<void> {
    await fs.mkdir(path.join(this.root, DATA_DIR), { recursive: true })
    await writeFileAtomic(this.settingsPath(), JSON.stringify(settings, null, 2) + '\n')
  }

  private settingsPath(): string {
    return path.join(this.root, DATA_DIR, 'settings.json')
  }
}
