/**
 * Which slide a lecture video shows when (SPEC 6b): small grayscale frames of the video are
 * compared with small renders of the slides, and the most likely sequence over time is picked
 * (Viterbi), so a frame that matches badly on its own still gets the slide its neighbours have.
 */

/** Frames and slides are compared at this size, grayscale, one byte per pixel. */
export const THUMB_WIDTH = 80
export const THUMB_HEIGHT = 45

export interface SlideThumb {
  /** Vault path of the PDF. */
  pdf: string
  page: number
  /**
   * Where it was dropped (`here`), or another lesson of the course (`nearby`), which the
   * lecturer may go back to but less likely.
   */
  group: 'here' | 'nearby'
  pixels: Uint8Array
}

/** A slide from a moment on; an empty `pdf` means no slide could be recognised. */
export interface Moment {
  at: number
  pdf: string
  page: number
}

// Tuned on synthetic recordings (slideMatch.test.ts); scores are correlations from -1 to 1.
const SCALE = 12
/** Below this a frame is more likely not a slide at all (the lecturer, a demo). */
const MATCH = 0.45
const NEXT = 0.5
const JUMP = 3
const JUMP_NEARBY = 6
const LEAVE = 3

/** Zero mean, unit length, after a light blur against video compression. */
export function normalise(pixels: Uint8Array): Float32Array {
  const w = THUMB_WIDTH
  const h = THUMB_HEIGHT
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy
          const xx = x + dx
          if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue
          sum += pixels[yy * w + xx]
          n++
        }
      }
      out[y * w + x] = sum / n
    }
  }
  let mean = 0
  for (const v of out) mean += v
  mean /= out.length
  let norm = 0
  for (let i = 0; i < out.length; i++) {
    out[i] -= mean
    norm += out[i] * out[i]
  }
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < out.length; i++) out[i] /= norm
  return out
}

const dot = (a: Float32Array, b: Float32Array): number => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/**
 * The slide on screen through the video, as moments where it changes. `frames` are taken
 * every `secondsPerFrame` seconds from the start.
 */
export function matchSlides(
  frames: Uint8Array[],
  slides: SlideThumb[],
  secondsPerFrame: number
): Moment[] {
  if (!frames.length || !slides.length) return []
  const n = slides.length
  const none = n
  const slideVecs = slides.map((s) => normalise(s.pixels))
  // The slide that comes right before each slide in its own PDF, for "moving on".
  const before = slides.map((s) =>
    slides.findIndex((o) => o.pdf === s.pdf && o.page === s.page - 1)
  )
  const jump = slides.map((s) => (s.group === 'here' ? JUMP : JUMP_NEARBY))

  let score = new Float64Array(n + 1)
  const back: Int32Array[] = []
  frames.forEach((frame, t) => {
    const vec = normalise(frame)
    const emit = (i: number): number => (i === none ? MATCH : dot(vec, slideVecs[i])) * SCALE
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
      const prev = before[i]
      if (prev !== -1 && score[prev] - NEXT > value) {
        value = score[prev] - NEXT
        origin = prev
      }
      if (score[best] - jump[i] > value) {
        value = score[best] - jump[i]
        origin = best
      }
      if (score[none] - LEAVE - (jump[i] - JUMP) > value) {
        value = score[none] - LEAVE - (jump[i] - JUMP)
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
  const path = new Array<number>(frames.length)
  for (let t = frames.length - 1; t >= 0; t--) {
    path[t] = state
    state = back[t][state]
  }

  const moments: Moment[] = []
  path.forEach((s, t) => {
    if (t > 0 && path[t - 1] === s) return
    const slide = s === none ? null : slides[s]
    moments.push({ at: t * secondsPerFrame, pdf: slide?.pdf ?? '', page: slide?.page ?? 0 })
  })
  return moments
}
