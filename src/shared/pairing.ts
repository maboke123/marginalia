import type { VaultNode } from './types'

/**
 * PDF path -> the notes linked to it. The first is the one lecture mode opens; picking
 * another note in lecture mode moves it to the front.
 */
export type NoteLinks = Record<string, string[]>

/** Links as stored in state.json; before several notes per PDF, each PDF had one string. */
export function noteLinks(raw: unknown): NoteLinks {
  const out: NoteLinks = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [pdf, value] of Object.entries(raw)) {
    const notes = (Array.isArray(value) ? value : [value]).filter(
      (n): n is string => typeof n === 'string'
    )
    if (notes.length) out[pdf] = notes
  }
  return out
}

/** `note` first in the PDF's list (added if new), or last with `asCurrent` false. */
export function withLink(links: NoteLinks, pdf: string, note: string, asCurrent = true): NoteLinks {
  const current = links[pdf] ?? []
  if (!asCurrent) return current.includes(note) ? links : { ...links, [pdf]: [...current, note] }
  if (current[0] === note) return links
  return { ...links, [pdf]: [note, ...current.filter((n) => n !== note)] }
}

export function withoutLink(links: NoteLinks, pdf: string, note: string): NoteLinks {
  if (!links[pdf]?.includes(note)) return links
  const rest = links[pdf].filter((n) => n !== note)
  const out = { ...links }
  if (rest.length) out[pdf] = rest
  else delete out[pdf]
  return out
}

const baseName = (node: Pick<VaultNode, 'name'>): string =>
  node.name.replace(/\.(md|pdf)$/i, '').toLowerCase()

/**
 * The notes that belong to each PDF in one folder: the notes linked to it, and the note with
 * the same name. Notes in another folder are not paired; each note pairs once. The sidebar
 * shows them under their PDF (in folder order), and moving the PDF takes them along.
 */
export function pairNotes<N extends Pick<VaultNode, 'name' | 'path' | 'kind'>>(
  children: N[],
  links: NoteLinks
): Map<string, N[]> {
  const owner = new Map<string, string>()
  const pdfs = children.filter((n) => n.kind === 'pdf')
  const notes = children.filter((n) => n.kind === 'markdown')
  // Links first, so a same-named note cannot take a note I linked on purpose.
  for (const pdf of pdfs) {
    for (const linked of links[pdf.path] ?? []) {
      const note = notes.find((n) => n.path === linked)
      if (note && !owner.has(note.path)) owner.set(note.path, pdf.path)
    }
  }
  for (const pdf of pdfs) {
    const note = notes.find((n) => baseName(n) === baseName(pdf) && !owner.has(n.path))
    if (note) owner.set(note.path, pdf.path)
  }
  const pairs = new Map<string, N[]>()
  for (const note of notes) {
    const pdf = owner.get(note.path)
    if (pdf) pairs.set(pdf, [...(pairs.get(pdf) ?? []), note])
  }
  return pairs
}
