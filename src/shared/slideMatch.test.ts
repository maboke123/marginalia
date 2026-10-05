import { describe, expect, it } from 'vitest'
import { matchSlides, THUMB_HEIGHT, THUMB_WIDTH, type SlideThumb } from './slideMatch'

const W = THUMB_WIDTH
const H = THUMB_HEIGHT

/** Small deterministic random numbers, so tests are repeatable. */
function random(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31
    return s / 2 ** 31
  }
}

/** A slide: white with dark blocks like lines of text, different per seed. */
function slide(seed: number): Uint8Array {
  const r = random(seed)
  const px = new Uint8Array(W * H).fill(245)
  for (let line = 0; line < 6; line++) {
    const y = 4 + line * 7
    const x0 = 4 + Math.floor(r() * 10)
    const len = 20 + Math.floor(r() * 50)
    for (let x = x0; x < Math.min(W - 2, x0 + len); x++) {
      for (let dy = 0; dy < 3; dy++) px[(y + dy) * W + x] = 40
    }
  }
  return px
}

/** What a video frame of a slide looks like: shifted a pixel, darker, with noise. */
function frame(pixels: Uint8Array, seed: number, noise = 25): Uint8Array {
  const r = random(seed)
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const src = pixels[y * W + Math.max(0, x - 1)]
      out[y * W + x] = Math.max(0, Math.min(255, src * 0.85 + 10 + (r() - 0.5) * 2 * noise))
    }
  }
  return out
}

/** Not a slide at all: the lecturer, a demo. */
const camera = (seed: number): Uint8Array => {
  const r = random(seed)
  return Uint8Array.from({ length: W * H }, () => Math.floor(r() * 255))
}

const deck = (pdf: string, count: number, group: 'here' | 'nearby', seed = 0): SlideThumb[] =>
  Array.from({ length: count }, (_, i) => ({
    pdf,
    page: i + 1,
    group,
    pixels: slide(seed + i + 1)
  }))

const pages = (m: { pdf: string; page: number }[]): string[] =>
  m.map((x) => (x.pdf ? `${x.pdf.split('/').pop()}:${x.page}` : 'none'))

describe('matchSlides', () => {
  const b2 = deck('ML/les_3/B2.pdf', 8, 'here')
  const show = (page: number, seed: number, noise?: number): Uint8Array =>
    frame(b2[page - 1].pixels, seed, noise)

  it('follows the slides as the lecture moves on', () => {
    const frames = [show(1, 1), show(1, 2), show(2, 3), show(2, 4), show(3, 5), show(3, 6)]
    const moments = matchSlides(frames, b2, 4)
    expect(pages(moments)).toEqual(['B2.pdf:1', 'B2.pdf:2', 'B2.pdf:3'])
    expect(moments.map((m) => m.at)).toEqual([0, 8, 16])
  })

  it('puts an unclear frame between slide 4 and 6 on slide 5', () => {
    const frames = [show(4, 1), show(4, 2), show(5, 3, 140), show(6, 4), show(6, 5)]
    expect(pages(matchSlides(frames, b2, 4))).toEqual(['B2.pdf:4', 'B2.pdf:5', 'B2.pdf:6'])
  })

  it('leaves out frames that show no slide, like the lecturer', () => {
    const frames = [show(2, 1), show(2, 2), camera(3), camera(4), camera(5), show(2, 6)]
    expect(pages(matchSlides(frames, b2, 4))).toEqual(['B2.pdf:2', 'none', 'B2.pdf:2'])
  })

  it('finds a slide of the previous lesson the lecturer went back to', () => {
    const b1 = deck('ML/les_2/B1.pdf', 5, 'nearby', 100)
    const frames = [
      frame(b1[3].pixels, 1),
      frame(b1[3].pixels, 2),
      frame(b1[4].pixels, 3),
      show(1, 4),
      show(1, 5),
      show(2, 6)
    ]
    expect(pages(matchSlides(frames, [...b2, ...b1], 4))).toEqual([
      'B1.pdf:4',
      'B1.pdf:5',
      'B2.pdf:1',
      'B2.pdf:2'
    ])
  })

  it('recognises a slide that changed a little since the recording', () => {
    // The old version: the last two lines of text are different.
    const old = Uint8Array.from(b2[2].pixels)
    old.set(slide(999).subarray(30 * W), 30 * W)
    const frames = [show(2, 1), frame(old, 2), frame(old, 3), show(4, 4)]
    expect(pages(matchSlides(frames, b2, 4))).toEqual(['B2.pdf:2', 'B2.pdf:3', 'B2.pdf:4'])
  })

  it('gives nothing without frames or slides', () => {
    expect(matchSlides([], b2, 4)).toEqual([])
    expect(matchSlides([show(1, 1)], [], 4)).toEqual([])
  })
})
