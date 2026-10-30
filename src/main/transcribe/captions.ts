import { paragraphs, type Segment } from './transcript'

/** Transcripts made elsewhere that can be imported: a video's captions, or plain text. */
export const TEXT_TRANSCRIPT = /\.(vtt|srt|txt)$/i

/** A paragraph of an imported transcript; `at` in seconds, null when the file has no times. */
export interface TranscriptPart {
  at: number | null
  text: string
}

const CUE_TIME = /^((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/

/** A time on its own at the start of a line: "12:34", "1:02:34", "[00:12:34]", "12:34 -". */
const LINE_TIME = /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:[.,]\d+)?\]?(?:\s*[-:]\s*|\s+|$)(.*)$/

function seconds(stamp: string): number {
  return stamp
    .replace(',', '.')
    .split(':')
    .reduce((total, part) => total * 60 + Number(part), 0)
}

/** Caption markup (`<v Speaker>`, `<c>`, `<00:00:01.000>`, `<i>`) and entities out. */
function plain(line: string): string {
  return line
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The cues of WebVTT or SubRip captions. Rolling captions (YouTube's) repeat the line of the
 * cue before; those repeats are left out.
 */
export function parseCaptions(text: string): Segment[] {
  const out: Segment[] = []
  let previous: string[] = []
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim())
    const at = lines.findIndex((l) => CUE_TIME.test(l))
    if (at === -1) continue
    const [, from, to] = CUE_TIME.exec(lines[at])!
    const said = lines
      .slice(at + 1)
      .map(plain)
      .filter(Boolean)
    const fresh = said.filter((l) => !previous.includes(l))
    previous = said
    if (fresh.length) {
      out.push({ from: seconds(from) * 1000, to: seconds(to) * 1000, text: fresh.join(' ') })
    }
  }
  return out
}

/** Plain text with a time at the start of some lines, as copied from a video site. */
function timedLines(text: string): Segment[] {
  const out: Segment[] = []
  for (const line of text.split('\n')) {
    const m = LINE_TIME.exec(line.trim())
    if (m) {
      const at = seconds(m[1]) * 1000
      if (out.length) out[out.length - 1].to = at
      out.push({ from: at, to: at, text: plain(m[2]) })
    } else if (out.length && line.trim()) {
      const last = out[out.length - 1]
      last.text = `${last.text} ${plain(line)}`.trim()
    }
  }
  return out.filter((s) => s.text)
}

const words = (text: string): number => text.split(/\s+/).filter(Boolean).length

/**
 * Untimed text in paragraphs of about 60 to 160 words: its own paragraphs, short ones joined,
 * long ones cut after a sentence.
 */
function untimed(text: string): TranscriptPart[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => plain(b.replace(/\n/g, ' ')))
    .filter(Boolean)
  const sentences = blocks.flatMap((b) =>
    words(b) > 160 ? (b.match(/[^.!?]+(?:[.!?]+|$)\s*/g) ?? [b]).map((s) => s.trim()) : [b]
  )
  const out: TranscriptPart[] = []
  let current = ''
  for (const piece of sentences.filter(Boolean)) {
    const next = current ? `${current} ${piece}` : piece
    if (current && words(next) > 160) {
      out.push({ at: null, text: current })
      current = piece
    } else {
      current = next
    }
    if (words(current) >= 60 && /[.!?]$/.test(current)) {
      out.push({ at: null, text: current })
      current = ''
    }
  }
  if (current) out.push({ at: null, text: current })
  return out
}

/** A transcript file from elsewhere in paragraphs, timed when the file has times. */
export function transcriptParts(fileName: string, text: string): TranscriptPart[] {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r/g, '')
  let segments = /\.(vtt|srt)$/i.test(fileName) ? parseCaptions(clean) : []
  // A .txt may hold captions too, or times at the start of lines.
  if (!segments.length) segments = parseCaptions(clean)
  if (!segments.length) {
    const timed = timedLines(clean)
    if (timed.length >= 3) segments = timed
  }
  if (!segments.length) return untimed(clean)
  return paragraphs(segments).map((p) => ({
    at: p.at,
    text: p.segments.map((s) => s.text).join(' ')
  }))
}
