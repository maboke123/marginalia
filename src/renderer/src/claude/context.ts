import { CONTEXT_END, CONTEXT_START, type ChatImage } from '../../../shared/claude'
import type { PageAnnotations } from '../../../shared/annotations'
import { isBlankPage, slideOf } from '../../../shared/blankPages'
import { pageOf } from '../annotations/doc'
import { imagePath } from '../annotations/images'
import { textAround } from '../editor/sections'
import { openNote, openPdf } from '../lib/open'
import { renderPage } from '../pdf/snapshot'
import { pageText } from '../pdf/text'
import { childrenOf } from '../lib/tree'
import { useApp } from '../store'
import { skillOf } from './skills'

/** One removable piece of the context packet, shown above the chat input. */
export interface Chip {
  id: string
  label: string
  title: string
}

const fileName = (path: string): string => path.split('/').pop() ?? path
const short = (text: string, n = 32): string =>
  text.length > n ? `${text.slice(0, n).trimEnd()}...` : text

/** What would go to Claude with the next message: whatever is visible now, plus @ files. */
export function currentChips(attached: string[]): Chip[] {
  const { pdfView, pdfSelection, noteCursor } = useApp.getState()
  const chips: Chip[] = []
  if (pdfView) {
    chips.push({
      id: 'slides',
      label: `${fileName(pdfView.path)} · p.${pdfView.page}`,
      title: 'Text and image of the slide you are on, and your annotations there'
    })
    if (pdfSelection?.path === pdfView.path) {
      chips.push({
        id: 'slide-selection',
        label: `“${short(pdfSelection.text)}”`,
        title: 'Text selected on the slide'
      })
    }
  }
  if (noteCursor) {
    const heading = noteCursor.headings[noteCursor.headings.length - 1]
    chips.push({
      id: 'summary',
      label: heading
        ? `${fileName(noteCursor.path)} · ${short(heading)}`
        : fileName(noteCursor.path),
      title: 'The summary around your cursor'
    })
    if (noteCursor.selection.trim()) {
      chips.push({
        id: 'summary-selection',
        label: `“${short(noteCursor.selection.trim())}”`,
        title: 'Text selected in the summary'
      })
    }
  }
  for (const path of attached) {
    chips.push({ id: `file:${path}`, label: `@${fileName(path)}`, title: path })
  }
  return chips
}

function describeAnnotations(page: PageAnnotations): string[] {
  const lines = page.textBoxes.map(
    (box) =>
      `- ${box.author === 'claude' ? 'your' : 'my'} note: ${box.markdown.replace(/\n+/g, ' ')}`
  )
  for (const h of page.highlights) {
    const verb =
      h.style === 'underline'
        ? 'underlined'
        : h.style === 'strikethrough'
          ? 'struck through'
          : 'highlighted'
    lines.push(`- ${verb}: "${h.text}"`)
  }
  const ink = page.strokes.filter((s) => s.tool === 'pen').length
  if (ink) lines.push(`- ${ink} handwritten pen stroke${ink === 1 ? '' : 's'} (see the image)`)
  const images = page.images?.length ?? 0
  if (images) lines.push(`- ${images} pasted image${images === 1 ? '' : 's'}`)
  return lines
}

// Screenshots are big; a few per slide is plenty of context.
const MAX_PASTED_IMAGES = 3

const block = (tag: string, text: string): string => `<${tag}>\n${text}\n</${tag}>`

/**
 * One slide of an open PDF for Claude: where it is, its text, an image (unless the same page
 * was sent before) and my annotations on it.
 */
export async function slideContext(
  path: string,
  page: number,
  lastImage: string | null
): Promise<{ lines: string[]; images: ChatImage[]; imageKey: string | null }> {
  const open = openPdf(path)
  const images: ChatImage[] = []
  let imageKey: string | null = null
  if (isBlankPage(page)) {
    const lines = [`A blank page I added after slide ${slideOf(page)} of ${path}, for extra notes.`]
    const notes = open?.doc ? describeAnnotations(pageOf(open.doc.getState().pages, page)) : []
    if (notes.length) lines.push('My annotations on this page:', ...notes)
    return { lines, images, imageKey }
  }
  const lines = [`Slides: ${path}, page ${page} of ${open?.pdf.numPages ?? '?'}.`]
  if (!open) return { lines, images, imageKey }
  const key = `${path}#${page}`
  const annotations = open.doc ? pageOf(open.doc.getState().pages, page) : null
  if (key !== lastImage) {
    images.push({ mediaType: 'image/png', data: await renderPage(open.pdf, page) })
    imageKey = key
    lines.push('An image of this page is attached.')
    const pasted = annotations?.images ?? []
    for (const im of pasted.slice(0, MAX_PASTED_IMAGES)) {
      const data = await window.api.vault.readFile(imagePath(path, im.src)).catch(() => null)
      const mediaType = /\.png$/i.test(im.src) ? 'image/png' : 'image/jpeg'
      if (data) images.push({ mediaType, data })
    }
    if (pasted.length) lines.push('The images I pasted on this page are attached after it.')
  } else {
    lines.push('The image of this page is in an earlier message.')
  }
  const text = await pageText(open.pdf, page)
  lines.push(block('page-text', text || '(this page has no text layer; use the image)'))
  const notes = annotations ? describeAnnotations(annotations) : []
  if (notes.length) lines.push('My annotations on this page:', ...notes)
  return { lines, images, imageKey }
}

export interface Packet {
  text: string
  images: ChatImage[]
  /** "path#page" of the slide image attached, if one was. */
  imageKey: string | null
}

/**
 * The context packet (SPEC section 6) for the chosen chips, in front of the question.
 * The slide image is left out when the previous message already carried the same page.
 */
export async function buildPacket(
  chat: string,
  chips: Chip[],
  question: string,
  lastImage: string | null
): Promise<Packet> {
  const { pdfView, pdfSelection, noteCursor } = useApp.getState()
  const ids = new Set(chips.map((c) => c.id))
  const lines = [CONTEXT_START, `Lesson folder: ${chat || '(vault root)'}`]
  // Recorded lectures: Claude reads them itself (Read tool) when a question needs them.
  const transcripts = childrenOf(useApp.getState().nodes, chat)
    .filter((n) => n.kind === 'markdown' && /^Transcript /.test(n.name))
    .map((n) => n.path)
  if (transcripts.length) {
    lines.push(
      'Transcripts of this lesson (what the lecturer said, with times and the slide on screen; ' +
        'read them when the question is about the lecture):',
      ...transcripts.map((p) => `- ${p}`)
    )
  }
  const images: ChatImage[] = []
  let imageKey: string | null = null

  if (ids.has('slides') && pdfView) {
    const slide = await slideContext(pdfView.path, pdfView.page, lastImage)
    lines.push(...slide.lines)
    images.push(...slide.images)
    imageKey = slide.imageKey
  }
  if (ids.has('slide-selection') && pdfSelection) {
    lines.push(`Selected on page ${pdfSelection.page}: "${pdfSelection.text}"`)
  }

  if (ids.has('summary') && noteCursor) {
    lines.push(`Summary: ${noteCursor.path}`)
    if (noteCursor.headings.length) {
      lines.push(`My cursor is under: ${noteCursor.headings.join(' > ')}`)
    }
    const view = openNote(noteCursor.path)?.view
    if (view) {
      const doc = view.state.doc.toString()
      const part = textAround(doc, view.state.selection.main.head)
      lines.push(
        part === doc ? 'The whole summary:' : 'The part of the summary around my cursor:',
        block('summary', part || '(empty)')
      )
    }
  }
  if (ids.has('summary-selection') && noteCursor?.selection.trim()) {
    lines.push(`Selected in the summary: "${noteCursor.selection.trim()}"`)
  }

  const files = chips.filter((c) => c.id.startsWith('file:')).map((c) => c.title)
  if (files.length) lines.push(`I attached these files; read them as needed: ${files.join(', ')}`)

  const skill = skillOf(question)
  if (skill) lines.push(`Skill /${skill.name}: follow these steps for my message.`, skill.steps)

  lines.push(CONTEXT_END, '', question)
  return { text: lines.join('\n'), images, imageKey }
}
