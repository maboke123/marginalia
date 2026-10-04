/** What a transcription run gives back: text with its place in the audio, in milliseconds. */
export interface Segment {
  from: number
  to: number
  text: string
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** 754 s -> "12:34", 3754 s -> "1:02:34". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}

/** "Transcript 2026-10-06 10-30.md": sorts by date and is a valid Windows file name. */
export function transcriptName(date: Date): string {
  return (
    `Transcript ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}-${pad(date.getMinutes())}.md`
  )
}

/** The first lines of a transcript note. */
export function transcriptHeader(opts: { date: Date; source: string; audio?: string }): string {
  const { date, source, audio } = opts
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const lines = [`# Transcript ${day}, ${time}`, '', source]
  if (audio) lines.push(`Audio: [${audio.split('/').pop()}](${encodeURI(audio)})`)
  return lines.join('\n') + '\n'
}

/**
 * One paragraph: when it was said, the slide on screen (a Markdown link, if any), then the
 * text. Whisper's segments of one chunk run together into one paragraph.
 */
export function transcriptParagraph(at: number, segments: Segment[], marker?: string): string {
  const text = segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    // Spoken text is plain text: "$5" must not start a formula, nor "*" emphasis.
    .replace(/[\\`*_[\]<$~#|]/g, '\\$&')
  if (!text) return ''
  return `\n**${clock(at)}**${marker ? ` · ${marker}` : ''} ${text}\n`
}

/**
 * Whisper's segments of a whole recording (a few seconds each) as paragraphs: a new one after
 * a pause or once a paragraph runs longer than `maxSeconds`. `at` is in seconds.
 */
export function paragraphs(
  segments: Segment[],
  maxSeconds = 45,
  pauseSeconds = 2
): { at: number; segments: Segment[] }[] {
  const out: { at: number; segments: Segment[] }[] = []
  for (const segment of segments) {
    const last = out[out.length - 1]
    const previous = last?.segments[last.segments.length - 1]
    const pause = previous ? (segment.from - previous.to) / 1000 : Infinity
    if (!last || pause >= pauseSeconds || segment.from / 1000 - last.at >= maxSeconds) {
      out.push({ at: segment.from / 1000, segments: [segment] })
    } else {
      last.segments.push(segment)
    }
  }
  return out
}
