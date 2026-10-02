import { create } from 'zustand'
import type { NotebookColor, Position, VaultInfo, VaultNode } from '../../shared/types'
import { findNode, parentOf, remap } from './lib/tree'

const api = window.api.vault

type NewItem = 'notebook' | 'section' | 'page'

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
  expanded: Record<string, boolean>
  selected: string | null
  activeFile: string | null
  renaming: string | null
  error: string | null

  init(): Promise<void>
  openVault(root?: string): Promise<void>
  refresh(): Promise<void>
  select(path: string | null): void
  setExpanded(path: string, open: boolean): void
  openFile(path: string): void
  startRename(path: string | null): void
  showError(message: string | null): void

  create(item: NewItem, parent: string): Promise<void>
  rename(path: string, name: string): Promise<void>
  move(path: string, parent: string, before?: Position): Promise<void>
  trash(path: string): Promise<void>
  setColor(notebook: string, color: NotebookColor | null): Promise<void>
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
    const { selected, activeFile } = get()
    set({
      selected: selected && remap(selected, from, to),
      activeFile: activeFile && remap(activeFile, from, to)
    })
    updateExpanded((e) =>
      Object.fromEntries(Object.entries(e).map(([p, open]) => [remap(p, from, to), open]))
    )
  }

  async function enter(vault: VaultInfo): Promise<void> {
    set({
      vault,
      expanded: loadExpanded(vault.root),
      selected: null,
      activeFile: null,
      renaming: null,
      recent: (await attempt(() => api.recent())) ?? get().recent
    })
    document.title = `${vault.name} - marginalia-poc`
    await get().refresh()
  }

  let errorTimer: ReturnType<typeof setTimeout> | undefined
  let initStarted = false

  return {
    vault: null,
    recent: [],
    ready: false,
    nodes: [],
    colors: {},
    expanded: {},
    selected: null,
    activeFile: null,
    renaming: null,
    error: null,

    async init() {
      // React's StrictMode runs effects twice in development.
      if (initStarted) return
      initStarted = true
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
      const { selected, activeFile } = get()
      set({
        nodes: tree.nodes,
        colors: tree.colors,
        selected: selected && findNode(tree.nodes, selected) ? selected : null,
        activeFile: activeFile && findNode(tree.nodes, activeFile) ? activeFile : null
      })
    },

    select: (path) => set({ selected: path }),

    setExpanded: (path, open) => updateExpanded((e) => ({ ...e, [path]: open })),

    openFile: (path) => set({ activeFile: path, selected: path }),

    startRename: (path) => set({ renaming: path }),

    showError(message) {
      clearTimeout(errorTimer)
      set({ error: message })
      if (message) errorTimer = setTimeout(() => set({ error: null }), 6000)
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
      const to = await attempt(() => api.move(path, parent, before))
      if (!to) return
      if (parent) get().setExpanded(parent, true)
      followMove(path, to)
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
