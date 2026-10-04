import type { VaultNode } from '../../../shared/types'

export interface Row {
  node: VaultNode
  depth: number
  parent: string
  /** For a note shown under its PDF: that PDF's path. */
  pairedWith?: string
}

export const isFolder = (node: VaultNode): boolean =>
  node.kind === 'notebook' || node.kind === 'section'

export function parentOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export function displayName(node: VaultNode): string {
  return node.kind === 'markdown' ? node.name.replace(/\.md$/i, '') : node.name
}

/** True when `path` is `ancestor` itself or lies somewhere inside it. */
export function isWithin(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(ancestor + '/')
}

/** After a rename or move, rewrites a path that pointed into the old location. */
export function remap(path: string, from: string, to: string): string {
  return isWithin(path, from) ? to + path.slice(from.length) : path
}

const baseName = (node: VaultNode): string => node.name.replace(/\.(md|pdf)$/i, '').toLowerCase()

/**
 * The note that belongs to each PDF in one folder: the note linked to it in lecture mode, else
 * the note with the same name. Notes in another folder are not paired; each note pairs once.
 */
export function pairNotes(
  children: VaultNode[],
  links: Record<string, string>
): Map<string, VaultNode> {
  const pairs = new Map<string, VaultNode>()
  const taken = new Set<string>()
  const pdfs = children.filter((n) => n.kind === 'pdf')
  const notes = children.filter((n) => n.kind === 'markdown')
  // Links first, so a same-named note cannot take a note I linked on purpose.
  for (const pdf of pdfs) {
    const note = notes.find((n) => n.path === links[pdf.path] && !taken.has(n.path))
    if (note) {
      pairs.set(pdf.path, note)
      taken.add(note.path)
    }
  }
  for (const pdf of pdfs) {
    if (pairs.has(pdf.path)) continue
    const note = notes.find((n) => baseName(n) === baseName(pdf) && !taken.has(n.path))
    if (note) {
      pairs.set(pdf.path, note)
      taken.add(note.path)
    }
  }
  return pairs
}

/** Children in the order the sidebar shows them: each PDF directly followed by its note. */
export function displayOrder(children: VaultNode[], links: Record<string, string>): VaultNode[] {
  const pairs = pairNotes(children, links)
  const paired = new Set([...pairs.values()].map((n) => n.path))
  return children.flatMap((node) => {
    if (paired.has(node.path)) return []
    const note = pairs.get(node.path)
    return note ? [node, note] : [node]
  })
}

export function visibleRows(
  nodes: VaultNode[],
  expanded: Record<string, boolean>,
  links: Record<string, string> = {}
): Row[] {
  const rows: Row[] = []
  const walk = (list: VaultNode[], depth: number, parent: string): void => {
    const pairs = pairNotes(list, links)
    const paired = new Set([...pairs.values()].map((n) => n.path))
    for (const node of list) {
      if (paired.has(node.path)) continue
      rows.push({ node, depth, parent })
      const note = pairs.get(node.path)
      if (note) rows.push({ node: note, depth: depth + 1, parent, pairedWith: node.path })
      if (node.children && expanded[node.path]) walk(node.children, depth + 1, node.path)
    }
  }
  walk(nodes, 0, '')
  return rows
}

export function findNode(nodes: VaultNode[], path: string): VaultNode | null {
  for (const node of nodes) {
    if (node.path === path) return node
    if (node.children && isWithin(path, node.path)) return findNode(node.children, path)
  }
  return null
}

export function childrenOf(nodes: VaultNode[], parent: string): VaultNode[] {
  return parent ? (findNode(nodes, parent)?.children ?? []) : nodes
}
