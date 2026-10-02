import { useApp } from '../store'

/** True while files from Explorer (not tree items) are dragged over the app. */
export function draggingFiles(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes('Files')
}

/** Imports the PDFs among the dropped files into `parent` (or the current section). */
export async function importDroppedFiles(e: React.DragEvent, parent?: string): Promise<void> {
  const files = [...e.dataTransfer.files]
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.name))
  const others = files.filter((f) => !/\.pdf$/i.test(f.name)).map((f) => f.name)
  const app = useApp.getState()
  if (pdfs.length) {
    await app.importPdfs(
      pdfs.map((f) => window.api.files.pathFor(f)),
      parent
    )
  }
  if (others.length) app.showError(`Only PDFs can be imported. Skipped: ${others.join(', ')}`)
}
