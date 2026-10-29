import { useApp } from '../store'
import { MEDIA_FILE, useFiles } from '../transcribe/files'

/** Data type of a file (not a folder) dragged from the sidebar: its vault path. */
export const TREE_FILE = 'application/x-marginalia-file'

/** True while a file from the sidebar is dragged, to open it next to what is open. */
export function draggingTreeFile(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(TREE_FILE)
}

/** True while files from Explorer (not tree items) are dragged over the app. */
export function draggingFiles(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes('Files')
}

/**
 * Imports the PDFs among the dropped files into `parent` (or the current section); a video or
 * audio recording is offered for transcription into that lesson.
 */
export async function importDroppedFiles(
  e: React.DragEvent,
  parent?: string,
  /** Dropped on this PDF: a video is about this deck. */
  pdf?: string
): Promise<void> {
  const files = [...e.dataTransfer.files]
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.name))
  const recordings = files.filter((f) => MEDIA_FILE.test(f.name))
  const others = files
    .filter((f) => !/\.pdf$/i.test(f.name) && !MEDIA_FILE.test(f.name))
    .map((f) => f.name)
  const app = useApp.getState()
  if (pdfs.length) {
    await app.importPdfs(
      pdfs.map((f) => window.api.files.pathFor(f)),
      parent
    )
  }
  // One at a time: each gets the choice between fast and accurate.
  if (recordings.length) {
    await useFiles.getState().transcribe(parent, window.api.files.pathFor(recordings[0]), pdf)
  }
  const skipped = [...others, ...recordings.slice(1).map((f) => f.name)]
  if (skipped.length) {
    app.showError(
      `Only PDFs and one recording at a time can be dropped. Skipped: ${skipped.join(', ')}`
    )
  }
}
