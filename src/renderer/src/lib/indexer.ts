import type { PdfToIndex } from '../../../shared/types'
import { loadPdf } from '../pdf/pdfjs'
import { pageText } from '../pdf/text'

// Extracts the text of new or changed PDFs in the background, for full-text search.
// pdf.js parses in its worker, so this does not hold up the interface.

export interface IndexProgress {
  done: number
  total: number
}

let running = false
let again = false
let progress: IndexProgress | null = null
const listeners = new Set<(p: IndexProgress | null) => void>()

function publish(next: IndexProgress | null): void {
  progress = next
  listeners.forEach((l) => l(next))
}

export function onIndexProgress(listener: (p: IndexProgress | null) => void): () => void {
  listeners.add(listener)
  listener(progress)
  return () => listeners.delete(listener)
}

async function indexOne({ path, stamp }: PdfToIndex): Promise<void> {
  const task = loadPdf(await window.api.vault.readFile(path))
  try {
    const pdf = await task.promise
    const pages: string[] = []
    for (let n = 1; n <= pdf.numPages; n++) pages.push(await pageText(pdf, n))
    await window.api.search.storePdf(path, stamp, pages)
  } finally {
    void task.destroy()
  }
}

/** Indexes whatever is missing. Calls while it runs make it check once more at the end. */
export async function indexPdfs(): Promise<void> {
  if (running) {
    again = true
    return
  }
  running = true
  try {
    do {
      again = false
      const todo = await window.api.search.pending().catch(() => [])
      for (let i = 0; i < todo.length; i++) {
        publish({ done: i, total: todo.length })
        await indexOne(todo[i]).catch(async (err) => {
          console.warn(`Could not index ${todo[i].path}:`, err)
          // Store it as empty so a broken PDF is not retried on every change.
          await window.api.search.storePdf(todo[i].path, todo[i].stamp, []).catch(() => {})
        })
      }
      publish(null)
    } while (again)
  } finally {
    running = false
  }
}
