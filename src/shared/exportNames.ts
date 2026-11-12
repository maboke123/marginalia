/** What a folder export makes a PDF of: slides (annotated), notes and canvases. */
export interface ExportItem {
  /** Vault path of the file. */
  path: string
  kind: 'pdf' | 'markdown' | 'canvas'
}

const LABEL: Record<ExportItem['kind'], string> = {
  pdf: 'slides',
  markdown: 'notes',
  canvas: 'canvas'
}

/**
 * The PDF name of each file in an export of `folder`, relative to the folder exported and
 * keeping its subfolders. "B2 trees.md" next to "B2 trees.pdf" becomes "B2 trees (notes).pdf",
 * so neither replaces the other; slides keep their own name.
 */
export function exportNames(folder: string, items: ExportItem[]): Map<string, string> {
  const prefix = folder ? `${folder}/` : ''
  const taken = new Set<string>()
  const names = new Map<string, string>()
  // Slides first, so they keep their names.
  const order = [...items].sort((a, b) => Number(b.kind === 'pdf') - Number(a.kind === 'pdf'))
  for (const item of order) {
    const rel = item.path.startsWith(prefix) ? item.path.slice(prefix.length) : item.path
    const stem = rel.replace(/\.(pdf|md|canvas)$/i, '')
    let name = `${stem}.pdf`
    if (taken.has(name.toLowerCase())) name = `${stem} (${LABEL[item.kind]}).pdf`
    for (let n = 2; taken.has(name.toLowerCase()); n++)
      name = `${stem} (${LABEL[item.kind]} ${n}).pdf`
    taken.add(name.toLowerCase())
    names.set(item.path, name)
  }
  return names
}
