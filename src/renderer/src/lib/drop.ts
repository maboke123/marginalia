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

/** Transcripts made elsewhere: a video's captions, or plain text (as main's TEXT_TRANSCRIPT). */
export const TEXT_TRANSCRIPT = /\.(vtt|srt|txt)$/i

/**
 * Imports the PDFs, notes (a friend's transcript, say) and transcripts made elsewhere (the
 * lecturer's video captions) among `paths` into `parent` (or the current section); a video or
 * audio recording is offered for transcription into that lesson, unless it is the recording of
 * a transcript that came along.
 */
export async function importPaths(
  paths: string[],
  parent?: string,
  /** Dropped on this PDF: a video or transcript is about this deck. */
  pdf?: string
): Promise<void> {
  const name = (p: string): string => p.split(/[\\/]/).pop() ?? p
  const pdfs = paths.filter((p) => /\.pdf$/i.test(p))
  const notes = paths.filter((p) => /\.md$/i.test(p))
  const transcripts = paths.filter((p) => TEXT_TRANSCRIPT.test(p))
  let recordings = paths.filter((p) => MEDIA_FILE.test(p))
  const others = paths.filter(
    (p) =>
      !pdfs.includes(p) && !notes.includes(p) && !transcripts.includes(p) && !recordings.includes(p)
  )
  const app = useApp.getState()
  if (pdfs.length) await app.importPdfs(pdfs, parent)
  if (notes.length) {
    const along = await app.importNotes(notes, parent, pdf, recordings)
    recordings = recordings.filter((r) => !along.includes(r))
  }
  if (transcripts.length) await app.importTranscripts(transcripts, parent, pdf)
  // One at a time: each gets the choice between fast and accurate.
  if (recordings.length) await useFiles.getState().transcribe(parent, recordings[0], pdf)
  const skipped = [...others, ...recordings.slice(1)].map(name)
  if (skipped.length) {
    app.showError(
      'Only PDFs, notes, transcripts and one recording at a time can be added. ' +
        `Skipped: ${skipped.join(', ')}`
    )
  }
}

/** `importPaths` for files dropped from Explorer. */
export function importDroppedFiles(
  e: React.DragEvent,
  parent?: string,
  pdf?: string
): Promise<void> {
  const paths = [...e.dataTransfer.files].map((f) => window.api.files.pathFor(f))
  return importPaths(paths, parent, pdf)
}
