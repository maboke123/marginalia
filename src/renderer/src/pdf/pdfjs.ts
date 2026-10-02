import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PageSize } from './layout'

GlobalWorkerOptions.workerSrc = workerUrl

// Copied next to index.html by vite-plugin-static-copy (see electron.vite.config.ts).
const assets = new URL('pdfjs/', document.baseURI).href

/** Call `destroy()` on the returned task to free the worker's memory for this document. */
export function loadPdf(data: Uint8Array): PDFDocumentLoadingTask {
  return getDocument({
    data,
    cMapUrl: `${assets}cmaps/`,
    standardFontDataUrl: `${assets}standard_fonts/`,
    iccUrl: `${assets}iccs/`,
    wasmUrl: `${assets}wasm/`
  })
}

export async function pageSizes(pdf: PDFDocumentProxy): Promise<PageSize[]> {
  const pages = Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1))
  return (await Promise.all(pages)).map((page) => {
    const { width, height } = page.getViewport({ scale: 1 })
    return { width, height }
  })
}
