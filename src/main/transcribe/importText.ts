import { promises as fs } from 'fs'
import path from 'path'
import { matchText, type SlideText } from '../../shared/textMatch'
import type { ImportTranscriptRequest } from '../../shared/types'
import { VaultError } from '../vault/names'
import type { Vault } from '../vault/vault'
import { transcriptParts } from './captions'
import { slideMarker, transcriptParagraph } from './transcript'

/** The deck of the folder a transcript goes under: the one it was dropped on, else most used. */
function mainPdf(
  folder: string,
  found: (SlideText | null)[],
  slides: SlideText[],
  given?: string
): string | null {
  if (given && path.posix.dirname(given) === folder) return given
  const count = new Map<string, number>()
  for (const s of found) {
    if (s && path.posix.dirname(s.pdf) === folder) count.set(s.pdf, (count.get(s.pdf) ?? 0) + 1)
  }
  const best = [...count].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (best) return best
  const here = [...new Set(slides.map((s) => s.pdf))].filter(
    (p) => path.posix.dirname(p) === folder
  )
  return here.length === 1 ? here[0] : null
}

/**
 * A transcript made elsewhere (the lecturer's video captions, say) as a transcript note in
 * `folder`, each paragraph linked to the slide its words match, and the note linked to its deck.
 */
export async function importTranscriptFile(
  vault: Vault,
  request: ImportTranscriptRequest
): Promise<{ note: string; pdf: string | null }> {
  const { folder, source, slides } = request
  const name = path.basename(source)
  const text = await fs.readFile(source, 'utf8').catch(() => {
    throw new VaultError(`File not found: ${source}`)
  })
  const parts = transcriptParts(name, text)
  if (!parts.length) throw new VaultError(`"${name}" has no text`)
  const found = matchText(
    parts.map((p) => p.text),
    slides
  ).map((i) => (i === null ? null : slides[i]))

  const base = name.replace(/\.[^.]+$/, '').replace(/^Transcript /i, '')
  const note = await vault.createNote(folder, `Transcript ${base}`)
  const timed = parts.some((p) => p.at !== null)
  const header =
    `# Transcript ${base}\n\nImported from ${name}. ` +
    `${timed ? 'Times are from the start of the video. ' : ''}` +
    'The slide links were found from the words.\n'
  const body = parts
    .map((p, i) => {
      const slide = found[i]
      const marker = slide ? slideMarker(note, slide.pdf, slide.page) : undefined
      return transcriptParagraph(p.at, [{ from: 0, to: 0, text: p.text }], marker)
    })
    .join('')
  await vault.writeText(note, header + body)
  const pdf = mainPdf(folder, found, slides, request.pdf)
  if (pdf) await vault.linkNote(pdf, note, 'add')
  return { note, pdf }
}

// "**12:34**", then maybe " · [slide 3](deck.pdf#page=3)", then the text.
const PARAGRAPH = /^(\*\*[\d:]+\*\*)(?: · \[slide \d+\]\((?:[^()\s]|\([^()\s]*\))*\))? (.*)$/

/**
 * Links each timed paragraph of a transcript to the slide its words match, instead of the
 * slide that was on my screen (I may have stayed on one). Returns how many got a slide.
 */
export async function linkByText(vault: Vault, note: string, slides: SlideText[]): Promise<number> {
  const lines = (await vault.readText(note)).split('\n')
  const paragraphs = lines.flatMap((line, i) => {
    const m = PARAGRAPH.exec(line)
    return m ? [{ i, clock: m[1], text: m[2] }] : []
  })
  if (!paragraphs.length) throw new VaultError('This transcript has no timed paragraphs to link')
  const found = matchText(
    paragraphs.map((p) => p.text.replace(/\\(.)/g, '$1')),
    slides
  )
  let linked = 0
  paragraphs.forEach((p, k) => {
    const slide = found[k] === null ? null : slides[found[k]!]
    if (slide) linked++
    const marker = slide ? ` · ${slideMarker(note, slide.pdf, slide.page)}` : ''
    lines[p.i] = `${p.clock}${marker} ${p.text}`
  })
  await vault.writeText(note, lines.join('\n'))
  if (!(await vault.linkedPdf(note))) {
    const pdf = mainPdf(
      path.posix.dirname(note),
      found.map((i) => (i === null ? null : slides[i])),
      slides
    )
    if (pdf) await vault.linkNote(pdf, note, 'add')
  }
  return linked
}
