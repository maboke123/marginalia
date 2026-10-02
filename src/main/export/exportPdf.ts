import fontkit from '@pdf-lib/fontkit'
import { promises as fs } from 'fs'
import path from 'path'
import type { PDFDocument, PDFFont, PDFPage, RGB } from 'pdf-lib'
import type { AnnotationFile, PageAnnotations, TextBox } from '../../shared/annotations'
import { strokeOutline } from '../../shared/ink'
import { HIGHLIGHT_OPACITY, pageUnit, TEXT_SIZES } from '../../shared/palette'
import { markdownToText } from '../../shared/plainText'

type PdfLib = typeof import('pdf-lib')

// Text box look, matching .text-box in the renderer's styles.css (in page points).
const PADDING_X = 7
const PADDING_TOP = 4
const LINE_HEIGHT = 1.35
const PAPER_TEXT = '#1f2328'
const CLAUDE_INK = '#1b7c83'
const MARGIN_RULE = '#d6d6d2'

// Windows fonts with wide Unicode coverage: text, then symbols such as subscript letters.
const FONT_FILES = ['segoeui.ttf', 'seguisym.ttf']

export interface ExportResult {
  bytes: Uint8Array
  /** Rotated pages are copied without their annotations. */
  skippedPages: number
}

interface Fonts {
  list: PDFFont[]
  covers: Set<number>[]
}

function hex(lib: PdfLib, color: string): RGB {
  const n = parseInt(color.replace('#', ''), 16)
  return lib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

async function loadFonts(lib: PdfLib, doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit)
  const dir = path.join(process.env['WINDIR'] ?? 'C:\\Windows', 'Fonts')
  const list: PDFFont[] = []
  for (const file of FONT_FILES) {
    const bytes = await fs.readFile(path.join(dir, file)).catch(() => null)
    if (bytes) list.push(await doc.embedFont(bytes, { subset: true }))
  }
  // Without them (not Windows), Helvetica still covers Latin text.
  if (!list.length) list.push(await doc.embedFont(lib.StandardFonts.Helvetica))
  return { list, covers: list.map((f) => new Set(f.getCharacterSet())) }
}

/** Splits text into runs that one font can draw; characters no font has fall to the first. */
function runs(text: string, fonts: Fonts): { text: string; font: PDFFont }[] {
  const out: { text: string; font: PDFFont }[] = []
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    let index = fonts.covers.findIndex((set) => set.has(code))
    if (index === -1) index = 0
    const font = fonts.list[index]
    const usable = fonts.covers[index].has(code) ? ch : '?'
    const last = out[out.length - 1]
    if (last?.font === font) last.text += usable
    else out.push({ text: usable, font })
  }
  return out
}

function width(text: string, fonts: Fonts, size: number): number {
  return runs(text, fonts).reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0)
}

/** Greedy word wrap; words longer than a line are broken. */
function wrap(text: string, fonts: Fonts, size: number, max: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/(?<=\s)/)) {
      if (width(line + word, fonts, size) <= max || !line) {
        line += word
        while (width(line.trimEnd(), fonts, size) > max && line.length > 1) {
          let cut = line.length - 1
          while (cut > 1 && width(line.slice(0, cut), fonts, size) > max) cut--
          lines.push(line.slice(0, cut))
          line = line.slice(cut)
        }
      } else {
        lines.push(line.trimEnd())
        line = word
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}

function drawTextBox(
  lib: PdfLib,
  page: PDFPage,
  toPdf: (x: number, y: number) => [number, number],
  box: TextBox,
  fonts: Fonts,
  pageWidth: number
): void {
  const size = box.fontSize ?? TEXT_SIZES[1].value * pageUnit(pageWidth)
  const lines = wrap(markdownToText(box.markdown), fonts, size, box.width - 2 * PADDING_X)
  const color = hex(lib, PAPER_TEXT)
  lines.forEach((line, i) => {
    const top = box.y + PADDING_TOP + i * size * LINE_HEIGHT
    // Baseline about 0.8 em below the top of the line box, as in the browser.
    const [left, y] = toPdf(box.x + PADDING_X, top + size * (LINE_HEIGHT - 1) * 0.5 + size * 0.8)
    let x = left
    for (const run of runs(line, fonts)) {
      page.drawText(run.text, { x, y, size, font: run.font, color })
      x += run.font.widthOfTextAtSize(run.text, size)
    }
  })
  if (box.author === 'claude') {
    const height = lines.length * size * LINE_HEIGHT + 2 * PADDING_TOP
    const [x, y] = toPdf(box.x, box.y + height)
    page.drawRectangle({ x, y, width: 2, height, color: hex(lib, CLAUDE_INK) })
  }
}

function drawPage(
  lib: PdfLib,
  page: PDFPage,
  annotations: PageAnnotations,
  origin: { x: number; top: number },
  fonts: Fonts,
  pageWidth: number
): void {
  // Annotations use points from the top-left of the visible page; PDF counts from the bottom.
  const toPdf = (x: number, y: number): [number, number] => [origin.x + x, origin.top - y]
  const multiply = lib.BlendMode.Multiply

  for (const h of annotations.highlights) {
    const color = hex(lib, h.color)
    for (const [rx, ry, rw, rh] of h.rects) {
      const style = h.style ?? 'highlight'
      if (style === 'highlight') {
        const [x, y] = toPdf(rx, ry + rh)
        page.drawRectangle({
          x,
          y,
          width: rw,
          height: rh,
          color,
          opacity: HIGHLIGHT_OPACITY,
          blendMode: multiply
        })
      } else {
        const line = Math.max(0.75, rh * 0.08)
        const at = style === 'underline' ? ry + rh : ry + rh * 0.55 + line / 2
        const [x, y] = toPdf(rx, at)
        page.drawRectangle({ x, y, width: rw, height: line, color })
      }
    }
  }

  // Highlighter under pen, like on screen.
  const strokes = [
    ...annotations.strokes.filter((s) => s.tool === 'highlighter'),
    ...annotations.strokes.filter((s) => s.tool === 'pen')
  ]
  for (const stroke of strokes) {
    const outline = strokeOutline(stroke)
    if (!outline) continue
    const highlighter = stroke.tool === 'highlighter'
    page.drawSvgPath(outline, {
      x: origin.x,
      y: origin.top,
      color: hex(lib, stroke.color),
      opacity: highlighter ? HIGHLIGHT_OPACITY : 1,
      blendMode: highlighter ? multiply : lib.BlendMode.Normal
    })
  }

  for (const box of annotations.textBoxes) drawTextBox(lib, page, toPdf, box, fonts, pageWidth)
}

/** True when anything sits to the right of its page, in the margin. */
function usesMargin(file: AnnotationFile, widths: number[]): boolean {
  return Object.entries(file.pages).some(([n, p]) => {
    const w = widths[Number(n) - 1] ?? Infinity
    return (
      p.textBoxes.some((b) => b.x + b.width > w + 1) ||
      p.strokes.some((s) => s.points.some(([x]) => x > w + 1)) ||
      p.highlights.some((h) => h.rects.some(([x, , rw]) => x + rw > w + 1))
    )
  })
}

/**
 * A flattened copy of a PDF with its annotations drawn in (SPEC section 4: the original is
 * never modified). When notes sit in the margin, every page is widened to keep them.
 */
export async function exportAnnotated(
  source: Uint8Array,
  annotations: AnnotationFile | null
): Promise<ExportResult> {
  // Loaded on first use; most sessions never export.
  const lib = await import('pdf-lib')
  const doc = await lib.PDFDocument.load(source, { updateMetadata: false })
  const pages = doc.getPages()
  const boxes = pages.map((p) => p.getCropBox())
  const widen =
    !!annotations &&
    usesMargin(
      annotations,
      boxes.map((b) => b.width)
    )
  const fonts = annotations ? await loadFonts(lib, doc) : null
  let skippedPages = 0

  pages.forEach((page, i) => {
    const box = boxes[i]
    const rotated = page.getRotation().angle % 360 !== 0
    const pageAnnotations = annotations?.pages[String(i + 1)]
    if (rotated) {
      if (pageAnnotations) skippedPages++
      return
    }
    if (widen) {
      const width = box.width * (1 + annotations!.marginWidth)
      page.setMediaBox(box.x, box.y, width, box.height)
      page.setCropBox(box.x, box.y, width, box.height)
      page.drawLine({
        start: { x: box.x + box.width, y: box.y },
        end: { x: box.x + box.width, y: box.y + box.height },
        thickness: 0.5,
        color: hex(lib, MARGIN_RULE)
      })
    }
    if (pageAnnotations && fonts) {
      drawPage(lib, page, pageAnnotations, { x: box.x, top: box.y + box.height }, fonts, box.width)
    }
  })

  return { bytes: await doc.save(), skippedPages }
}
