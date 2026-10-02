import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { AnnotationFile } from '../../shared/annotations'
import { exportAnnotated } from './exportPdf'

async function slides(count: number, rotateLast = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= count; i++) {
    const page = doc.addPage([960, 540])
    page.drawText(`Slide ${i}`, { x: 60, y: 440, size: 40, font })
  }
  if (rotateLast) doc.getPages()[count - 1].setRotation(degrees(90))
  return doc.save()
}

const annotations = (pages: AnnotationFile['pages']): AnnotationFile => ({
  version: 1,
  pdf: 'slides.pdf',
  pdfSha256: 'x',
  marginWidth: 0.6,
  pages
})

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/'
  })
  const pdf = await task.promise
  const texts: string[] = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent()
    texts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
  }
  await task.destroy()
  return texts
}

// The first test loads pdf-lib, the fonts and pdf.js, which takes a few seconds when cold.
describe('exportAnnotated', { timeout: 20_000 }, () => {
  it('draws annotations into a copy and widens pages for margin notes', async () => {
    const source = await slides(2)
    const before = Buffer.from(source).toString('base64')
    const result = await exportAnnotated(
      source,
      annotations({
        '1': {
          strokes: [
            {
              id: 's1',
              tool: 'pen',
              color: '#cf222e',
              width: 3,
              points: [
                [100, 100, 0.5],
                [140, 120, 0.5],
                [180, 110, 0.5],
                [220, 130, 0.5]
              ],
              author: 'me'
            }
          ],
          highlights: [
            { id: 'h1', color: '#ffd33d', text: 'Slide', rects: [[60, 60, 120, 40]], author: 'me' }
          ],
          textBoxes: [
            {
              id: 't1',
              x: 980,
              y: 20,
              width: 300,
              markdown: '**Entropie** daalt: $\\Delta H = \\sum_i p_i$',
              author: 'claude'
            }
          ]
        }
      })
    )

    // The source bytes are untouched.
    expect(Buffer.from(source).toString('base64')).toBe(before)
    const out = await PDFDocument.load(result.bytes)
    expect(out.getPages().map((p) => Math.round(p.getWidth()))).toEqual([1536, 1536])
    expect(result.skippedPages).toBe(0)
    const [first, second] = await pageTexts(result.bytes)
    expect(first).toContain('Slide 1')
    expect(first.replace(/\s+/g, '')).toContain('Entropiedaalt:ΔH=∑ᵢpᵢ')
    expect(second).toBe('Slide 2')
  })

  it('keeps the page size without margin notes and skips rotated pages', async () => {
    const result = await exportAnnotated(
      await slides(2, true),
      annotations({
        '2': {
          strokes: [],
          highlights: [],
          textBoxes: [{ id: 't', x: 10, y: 10, width: 200, markdown: 'note', author: 'me' }]
        }
      })
    )
    const out = await PDFDocument.load(result.bytes)
    expect(out.getPages().map((p) => Math.round(p.getWidth()))).toEqual([960, 960])
    expect(result.skippedPages).toBe(1)
  })
})
