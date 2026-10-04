import { describe, expect, it } from 'vitest'
import { Chunker, RATE, toPcm16, type Chunk } from './chunker'

/** Loud everywhere except a quiet stretch around `quietAt` seconds. */
function speech(seconds: number, quietAt: number[]): Float32Array {
  const s = new Float32Array(seconds * RATE)
  for (let i = 0; i < s.length; i++) {
    const t = i / RATE
    const quiet = quietAt.some((q) => Math.abs(t - q) < 0.15)
    s[i] = quiet ? 0.001 * Math.sin(i) : 0.5 * Math.sin(i / 3)
  }
  return s
}

describe('Chunker', () => {
  it('cuts at the quiet moment between 25 and 35 seconds', () => {
    const chunker = new Chunker()
    const chunks = chunker.push(speech(40, [28.4]))
    expect(chunks).toHaveLength(1)
    expect(chunks[0].at).toBe(0)
    expect(chunks[0].samples.length / RATE).toBeCloseTo(28.4, 0)
    const rest = chunker.flush()!
    expect(rest.at).toBeCloseTo(28.4, 0)
    expect((chunks[0].samples.length + rest.samples.length) / RATE).toBe(40)
  })

  it('keeps time across many small pushes', () => {
    const chunker = new Chunker()
    const audio = speech(70, [27, 60])
    const chunks: Chunk[] = []
    for (let i = 0; i < audio.length; i += 1600)
      chunks.push(...chunker.push(audio.slice(i, i + 1600)))
    chunks.push(chunker.flush()!)
    expect(chunks.map((c) => Math.round(c.at))).toEqual([0, 27, 60])
    expect(chunks.reduce((n, c) => n + c.samples.length, 0)).toBe(audio.length)
  })

  it('has nothing to flush when nothing was recorded', () => {
    expect(new Chunker().flush()).toBeNull()
  })

  it('turns samples into 16-bit PCM', () => {
    const pcm = new Int16Array(toPcm16(new Float32Array([0, 1, -1, 2])).buffer)
    expect([...pcm]).toEqual([0, 32767, -32768, 32767])
  })
})
