import { fold } from './text'

/**
 * Which slide each paragraph of a transcript is about, from the words alone (a transcript that
 * came without its video, or one recorded while I stayed on one slide). Paragraphs are compared
 * with the text of the slides (tf-idf), and the most likely walk through the slides is picked
 * (Viterbi), as matchSlides does for video frames: lecturers mostly go forward, a few slides
 * at a time.
 */

export interface SlideText {
  /** Vault path of the PDF. */
  pdf: string
  page: number
  /** The deck(s) of this lesson, or another lesson of the course. */
  group: 'here' | 'nearby'
  text: string
}

// Tuned on textMatch.test.ts and a real lecture; scores are cosine similarities from 0 to 1.
const SCALE = 10
/** Below this a paragraph is more likely about no slide (questions, organisation). */
const MATCH = 0.06
const NEXT = 0.3
/** Each slide skipped on the way forward. */
const SKIP = 0.35
const SKIP_MAX = 8
const JUMP = 2.5
const JUMP_NEARBY = 5
const LEAVE = 1.5

const STOP = new Set(
  (
    'the and that this with for are was were you your have has had not but they them their ' +
    'there then than what when where which who will would can could should about into from ' +
    'just like also some more very here because its our out one get got going know think ' +
    'say said see well right okay yeah let now how why all any each other only same such ' +
    'these those been being over after before again once really thing things want need ' +
    'make made use used way look lot kind sort maybe something actually basically mean ' +
    'het een van dat die niet met voor zijn maar ook als dan wat aan bij nog naar uit ' +
    'worden wordt kan zij jij ons hun hoe waar wel heel even gewoon eigenlijk'
  ).split(' ')
)

/** "classes" -> "class", "responsibilities" -> "responsibility", "patterns" -> "pattern". */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.endsWith('sses')) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

export function terms(text: string): string[] {
  return (fold(text).match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w))
    .map(stem)
}

type Vector = Map<string, number>

function counts(words: string[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const w of words) out.set(w, (out.get(w) ?? 0) + 1)
  return out
}

/** Weighted by rarity across the slides, unit length; words no slide has are left out. */
function vector(words: string[], idf: Map<string, number>): Vector {
  const out: Vector = new Map()
  let norm = 0
  for (const [w, n] of counts(words)) {
    const weight = idf.get(w)
    if (!weight) continue
    const v = (1 + Math.log(n)) * weight
    out.set(w, v)
    norm += v * v
  }
  norm = Math.sqrt(norm)
  if (norm) for (const [w, v] of out) out.set(w, v / norm)
  return out
}

function cosine(a: Vector, b: Vector): number {
  const [small, big] = a.size < b.size ? [a, b] : [b, a]
  let sum = 0
  for (const [w, v] of small) sum += v * (big.get(w) ?? 0)
  return sum
}

/** For each paragraph the index of its slide in `slides`, or null when none fits. */
export function matchText(parts: string[], slides: SlideText[]): (number | null)[] {
  if (!parts.length || !slides.length) return parts.map(() => null)
  const n = slides.length
  const none = n
  const slideWords = slides.map((s) => terms(s.text))
  const df = new Map<string, number>()
  for (const words of slideWords) for (const w of new Set(words)) df.set(w, (df.get(w) ?? 0) + 1)
  // A word on every slide (the course name in the footer) says nothing.
  const idf = new Map([...df].map(([w, d]) => [w, Math.log(n / d)]))
  const slideVecs = slideWords.map((words) => vector(words, idf))
  const index = new Map(slides.map((s, i) => [`${s.page}\n${s.pdf}`, i]))
  const jump = slides.map((s) => (s.group === 'here' ? JUMP : JUMP_NEARBY))

  let score = new Float64Array(n + 1)
  const back: Int32Array[] = []
  parts.forEach((part, t) => {
    const vec = vector(terms(part), idf)
    const emit = (i: number): number => (i === none ? MATCH : cosine(vec, slideVecs[i])) * SCALE
    const next = new Float64Array(n + 1)
    const from = new Int32Array(n + 1)
    if (t === 0) {
      for (let i = 0; i <= n; i++) next[i] = emit(i) - (i === none ? 0 : jump[i] - JUMP)
      back.push(from)
      score = next
      return
    }
    let best = 0
    for (let i = 1; i < n; i++) if (score[i] > score[best]) best = i
    for (let i = 0; i < n; i++) {
      let value = score[i]
      let origin = i
      for (let k = 1; k <= SKIP_MAX; k++) {
        const prev = index.get(`${slides[i].page - k}\n${slides[i].pdf}`)
        if (prev === undefined) continue
        const cost = NEXT + SKIP * (k - 1)
        if (score[prev] - cost > value) {
          value = score[prev] - cost
          origin = prev
        }
      }
      if (score[best] - jump[i] > value) {
        value = score[best] - jump[i]
        origin = best
      }
      const enter = LEAVE + (jump[i] - JUMP)
      if (score[none] - enter > value) {
        value = score[none] - enter
        origin = none
      }
      next[i] = value + emit(i)
      from[i] = origin
    }
    const leave = score[best] - LEAVE
    next[none] = (score[none] >= leave ? score[none] : leave) + emit(none)
    from[none] = score[none] >= leave ? none : best
    back.push(from)
    score = next
  })

  let state = 0
  for (let i = 1; i <= n; i++) if (score[i] > score[state]) state = i
  const path = new Array<number | null>(parts.length)
  for (let t = parts.length - 1; t >= 0; t--) {
    path[t] = state === none ? null : state
    state = back[t][state]
  }
  return path
}
