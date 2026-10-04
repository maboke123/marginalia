/** The rate whisper wants; the microphone is recorded at this rate. */
export const RATE = 16_000

export interface Chunk {
  samples: Float32Array
  /** Seconds from the start of the recording. */
  at: number
}

const rms = (s: Float32Array, from: number, to: number): number => {
  let sum = 0
  for (let i = from; i < to; i++) sum += s[i] * s[i]
  return Math.sqrt(sum / Math.max(1, to - from))
}

/**
 * Cuts the microphone stream into pieces of about 30 s for whisper. A cut falls on the
 * quietest moment between `min` and `max` seconds, so a word is not split in two.
 */
export class Chunker {
  private buffer = new Float32Array(0)
  private emitted = 0

  constructor(
    private readonly min = 25 * RATE,
    private readonly max = 35 * RATE,
    private readonly window = RATE / 10
  ) {}

  push(samples: Float32Array): Chunk[] {
    const next = new Float32Array(this.buffer.length + samples.length)
    next.set(this.buffer)
    next.set(samples, this.buffer.length)
    this.buffer = next
    const chunks: Chunk[] = []
    while (this.buffer.length >= this.max) chunks.push(this.cut(this.quietestCut()))
    return chunks
  }

  /** What is left when the recording stops. */
  flush(): Chunk | null {
    return this.buffer.length >= this.window ? this.cut(this.buffer.length) : null
  }

  private quietestCut(): number {
    let best = this.max
    let quietest = Infinity
    for (let start = this.min; start + this.window <= this.max; start += this.window) {
      const level = rms(this.buffer, start, start + this.window)
      if (level < quietest) {
        quietest = level
        best = start + this.window / 2
      }
    }
    return best
  }

  private cut(at: number): Chunk {
    const chunk = { samples: this.buffer.slice(0, at), at: this.emitted / RATE }
    this.emitted += at
    this.buffer = this.buffer.slice(at)
    return chunk
  }
}

/** Float samples (-1..1) as 16-bit PCM bytes. */
export function toPcm16(samples: Float32Array): Uint8Array {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return new Uint8Array(out.buffer)
}
