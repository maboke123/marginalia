import type { EditorView } from '@codemirror/view'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { AnnotationDoc } from '../annotations/doc'
import type { CanvasDoc } from '../canvas/doc'
import type { PageSize } from '../pdf/layout'

// The documents open in a pane right now. Claude's tools work on these, so its edits appear
// live and land in the same undo history as mine.

export interface OpenPdf {
  path: string
  pdf: PDFDocumentProxy
  /** null when annotations are off (damaged sidecar, or a replaced PDF not confirmed yet). */
  doc: AnnotationDoc | null
  sizes: PageSize[]
  margin: number
}

export interface OpenNote {
  path: string
  view: EditorView
}

export interface OpenCanvas {
  path: string
  /** null when the file is damaged and shown read-only. */
  doc: CanvasDoc | null
  /** The world rectangle on screen now. */
  view(): { x: number; y: number; width: number; height: number }
  /** Moves the view so the rectangle shows, for when I click Claude's change. */
  reveal(rect: { x: number; y: number; width: number; height: number }): void
  /** Shows all of the canvas for a screenshot; returns a function that puts my view back. */
  fitAll(): () => void
}

const pdfs = new Map<string, OpenPdf>()
const canvases = new Map<string, OpenCanvas>()
const notes = new Map<string, OpenNote>()
const listeners = new Set<() => void>()

function register<T>(map: Map<string, T>, path: string, item: T): () => void {
  map.set(path, item)
  listeners.forEach((l) => l())
  return () => {
    if (map.get(path) === item) map.delete(path)
  }
}

export const registerPdf = (item: OpenPdf): (() => void) => register(pdfs, item.path, item)
export const registerNote = (item: OpenNote): (() => void) => register(notes, item.path, item)
export const openPdf = (path: string): OpenPdf | null => pdfs.get(path) ?? null
export const openNote = (path: string): OpenNote | null => notes.get(path) ?? null
export const registerCanvas = (item: OpenCanvas): (() => void) =>
  register(canvases, item.path, item)
export const openCanvas = (path: string): OpenCanvas | null => canvases.get(path) ?? null

/** Resolves once `get` finds the document (say after opening the file), or null after a timeout. */
export function whenOpen<T>(get: () => T | null, timeoutMs = 10_000): Promise<T | null> {
  const found = get()
  if (found) return Promise.resolve(found)
  return new Promise((resolve) => {
    const check = (): void => {
      const item = get()
      if (!item) return
      done(item)
    }
    const done = (item: T | null): void => {
      listeners.delete(check)
      clearTimeout(timer)
      resolve(item)
    }
    const timer = setTimeout(() => done(null), timeoutMs)
    listeners.add(check)
  })
}
