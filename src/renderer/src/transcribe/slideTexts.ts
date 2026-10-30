import type { SlideText } from '../../../shared/textMatch'
import { loadPdf } from '../pdf/pdfjs'
import { pageText } from '../pdf/text'
import type { Candidate } from './candidates'

/** The text of every page of the candidate decks, to match a transcript's words against. */
export async function slideTexts(candidates: Candidate[]): Promise<SlideText[]> {
  const out: SlideText[] = []
  for (const { pdf: path, group } of candidates) {
    const data = await window.api.vault.readFile(path).catch(() => null)
    if (!data) continue
    const task = loadPdf(data)
    try {
      const pdf = await task.promise
      for (let n = 1; n <= pdf.numPages; n++) {
        out.push({ pdf: path, page: n, group, text: await pageText(pdf, n) })
      }
    } catch (err) {
      console.warn(`Could not read the text of ${path}:`, err)
    } finally {
      await task.destroy()
    }
  }
  return out
}
