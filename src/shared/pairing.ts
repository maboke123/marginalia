import type { VaultNode } from './types'

const baseName = (node: Pick<VaultNode, 'name'>): string =>
  node.name.replace(/\.(md|pdf)$/i, '').toLowerCase()

/**
 * The note that belongs to each PDF in one folder: the note linked to it in lecture mode, else
 * the note with the same name. Notes in another folder are not paired; each note pairs once.
 * The sidebar shows a note under its PDF, and moving the PDF takes the note along.
 */
export function pairNotes<N extends Pick<VaultNode, 'name' | 'path' | 'kind'>>(
  children: N[],
  links: Record<string, string>
): Map<string, N> {
  const pairs = new Map<string, N>()
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
