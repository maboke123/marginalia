import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import { writeFileAtomic } from '../vault/atomic'
import type { Segment } from './transcript'

/** A long recording goes to whisper in pieces of about this long, saved after each one. */
export const PIECE_SECONDS = 300
// A piece ends at the quietest moment in its last few seconds, so no word is cut in two.
const SEARCH_SECONDS = 10
const FRAME_SECONDS = 0.1

/** The 16-bit samples of a WAV file (ffmpeg may put a LIST chunk before the data). */
export function pcmOfWav(wav: Buffer): Int16Array {
  let at = 12
  while (at + 8 <= wav.length) {
    const id = wav.toString('ascii', at, at + 4)
    const size = wav.readUInt32LE(at + 4)
    if (id === 'data') {
      const end = Math.min(wav.length, at + 8 + size)
      const bytes = wav.subarray(at + 8, end - ((end - at - 8) % 2))
      // Copied, so the samples start on an even byte.
      return new Int16Array(Uint8Array.from(bytes).buffer)
    }
    at += 8 + size + (size % 2)
  }
  throw new Error('Not a WAV file')
}

/**
 * Where to cut a recording into pieces, as sample offsets from `from` to the end (both
 * included). Each cut is at the quietest moment of the seconds before the piece is full.
 */
export function pieceBounds(
  samples: Int16Array,
  rate: number,
  from = 0,
  seconds = PIECE_SECONDS
): number[] {
  const bounds = [from]
  const frame = Math.round(rate * FRAME_SECONDS)
  let start = from
  while (samples.length - start > seconds * rate) {
    const target = start + seconds * rate
    let best = target
    let quietest = Infinity
    for (let f = target - SEARCH_SECONDS * rate; f + frame <= target; f += frame) {
      let energy = 0
      for (let i = f; i < f + frame; i++) energy += samples[i] * samples[i]
      if (energy < quietest) {
        quietest = energy
        best = f + Math.floor(frame / 2)
      }
    }
    bounds.push(best)
    start = best
  }
  bounds.push(samples.length)
  return bounds
}

/** What is done of one recording with one model and language, to pick up after a stop. */
export interface Checkpoint {
  /** Sample offset where the next piece starts. */
  done: number
  /** With times from the start of the recording. */
  segments: Segment[]
}

/** Same file (path, size, time changed), model and language: same checkpoint. */
export async function checkpointFile(
  dir: string,
  source: string,
  model: string,
  language: string
): Promise<string> {
  const stat = await fs.stat(source)
  const key = [path.resolve(source).toLowerCase(), stat.size, stat.mtimeMs, model, language]
  return path.join(dir, `${createHash('sha1').update(key.join('|')).digest('hex')}.json`)
}

export async function readCheckpoint(file: string): Promise<Checkpoint | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Checkpoint
    return Number.isInteger(parsed.done) && Array.isArray(parsed.segments) ? parsed : null
  } catch {
    return null
  }
}

export async function writeCheckpoint(file: string, checkpoint: Checkpoint): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await writeFileAtomic(file, JSON.stringify(checkpoint))
}

/** Checkpoints nobody came back for in a month are dropped. */
export async function pruneCheckpoints(dir: string, maxAgeMs = 30 * 24 * 3600_000): Promise<void> {
  const names = await fs.readdir(dir).catch(() => [] as string[])
  for (const name of names) {
    const file = path.join(dir, name)
    const stat = await fs.stat(file).catch(() => null)
    if (stat && Date.now() - stat.mtimeMs > maxAgeMs) await fs.rm(file, { force: true })
  }
}
