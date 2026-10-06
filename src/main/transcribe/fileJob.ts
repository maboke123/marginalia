import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { THUMB_HEIGHT, THUMB_WIDTH, type SlideThumb } from '../../shared/slideMatch'
import type { TranscribeJob, TranscribeJobPhase } from '../../shared/types'
import { VaultError } from '../vault/names'
import { timestamp, type Vault } from '../vault/vault'
import type { Model, Transcriber } from './engine'
import createMatchWorker from './matchWorker?nodeWorker'
import { checkpointFile, pcmOfWav, pieceBounds, readCheckpoint, writeCheckpoint } from './pieces'
import {
  headerOf,
  paragraphs,
  slideAt,
  slideMarker,
  transcriptHeader,
  transcriptName,
  transcriptParagraph,
  type Segment,
  type SlideMoment
} from './transcript'
import { SAMPLE_RATE, wavFromPcm } from './wav'

export interface FileJob {
  folder: string
  /** Absolute path of the video or audio file; it is only read. */
  source: string
  model: Model
  language: string
  /** A recorded transcript to fill in, instead of a new note (its audio is the source). */
  into?: string
  /** Which slide was open when, for slide links in the paragraphs. */
  timeline?: SlideMoment[]
  /** Small renders of the slides the video may show, to find out which one it shows when. */
  slides?: SlideThumb[]
  /** Folder for checkpoints, so a stopped job picks up where it was. */
  checkpoints?: string
  signal: AbortSignal
  onProgress(phase: TranscribeJobPhase, percent: number, info?: ProgressInfo): void
}

export type ProgressInfo = Partial<Pick<TranscribeJob, 'read' | 'done' | 'total' | 'resumed'>>

/** "01:23:45.67" -> seconds */
const seconds = (hms: string): number =>
  hms.split(':').reduce((total, part) => total * 60 + Number(part), 0)

/**
 * Reads the sound of a recording with ffmpeg: 16 kHz WAV for whisper, and a small opus copy
 * to keep with the transcript. Reports how far it got: a percentage, or null when the file
 * does not say how long it is (webm from the app's own recorder), with the seconds read.
 */
export function extractAudio(
  source: string,
  wav: string,
  opus: string,
  signal: AbortSignal,
  onProgress: (percent: number | null, read: number) => void
): Promise<void> {
  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    source,
    ...['-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav],
    ...['-vn', '-ac', '1', '-c:a', 'libopus', '-b:a', '32k', opus]
  ]
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { windowsHide: true, signal })
    if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
    let duration = 0
    let errors = ''
    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString()
      errors = (errors + text).slice(-2000)
      const total = /Duration: (\d+:\d+:[\d.]+)/.exec(text)
      if (total) duration = seconds(total[1])
      const at = [...text.matchAll(/time=(\d+:\d+:[\d.]+)/g)].pop()
      if (!at) return
      const read = seconds(at[1])
      onProgress(duration ? Math.min(100, (read / duration) * 100) : null, read)
    })
    child.on('error', (err: NodeJS.ErrnoException) =>
      reject(
        err.code === 'ENOENT'
          ? new VaultError(
              'Reading recordings needs ffmpeg. Install it with "winget install Gyan.FFmpeg", then restart the app.'
            )
          : err
      )
    )
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(
            new VaultError(`ffmpeg could not read this file: ${errors.trim().split('\n').pop()}`)
          )
    )
  })
}

/** A frame is compared with the slides every this many seconds. */
const SECONDS_PER_FRAME = 4

/**
 * Small grayscale frames of a video, one every few seconds, for slide matching. An audio file
 * has none: then this gives an empty list instead of failing the transcription.
 */
export function extractFrames(
  source: string,
  signal: AbortSignal,
  onProgress: (percent: number) => void
): Promise<Uint8Array[]> {
  const w = THUMB_WIDTH
  const h = THUMB_HEIGHT
  const size = w * h
  const filter =
    `fps=1/${SECONDS_PER_FRAME},scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=white,format=gray`
  const args = ['-hide_banner', '-nostdin', '-i', source, '-an', '-vf', filter]
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [...args, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], {
      windowsHide: true,
      signal
    })
    if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
    const chunks: Buffer[] = []
    let duration = 0
    child.stdout.on('data', (data: Buffer) => chunks.push(data))
    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString()
      const total = /Duration: (\d+:\d+:[\d.]+)/.exec(text)
      if (total) duration = seconds(total[1])
      const at = [...text.matchAll(/time=(\d+:\d+:[\d.]+)/g)].pop()
      if (at && duration) onProgress(Math.min(100, (seconds(at[1]) / duration) * 100))
    })
    child.on('error', reject)
    child.on('close', () => {
      const all = Buffer.concat(chunks)
      const frames: Uint8Array[] = []
      for (let i = 0; i + size <= all.length; i += size) {
        frames.push(new Uint8Array(all.subarray(i, i + size)))
      }
      resolve(frames)
    })
  })
}

/** Runs the matching in a worker thread: it takes seconds for a whole lecture. */
function matchInWorker(frames: Uint8Array[], slides: SlideThumb[]): Promise<SlideMoment[]> {
  const worker = createMatchWorker({
    workerData: { frames, slides, secondsPerFrame: SECONDS_PER_FRAME }
  })
  return new Promise((resolve, reject) => {
    worker.once('message', (moments: SlideMoment[]) => {
      void worker.terminate()
      resolve(moments)
    })
    worker.once('error', reject)
  })
}

/**
 * Runs whisper over a few minutes at a time and saves what it has after each piece, so a job
 * that was cancelled, crashed or interrupted by sleep goes on from the last piece.
 */
async function transcribeInPieces(
  engine: Transcriber,
  job: FileJob,
  wav: string,
  temp: string,
  checkpoint: string | false | undefined
): Promise<Segment[]> {
  const samples = pcmOfWav(await fs.readFile(wav))
  const total = samples.length / SAMPLE_RATE
  const saved = checkpoint ? await readCheckpoint(checkpoint) : null
  const start = saved && saved.done <= samples.length ? saved.done : 0
  let segments = start ? saved!.segments : []
  const resumed = start > 0
  const report = (at: number): void =>
    job.onProgress('transcribing', (at / samples.length) * 100, {
      done: at / SAMPLE_RATE,
      total,
      resumed
    })
  const bounds = pieceBounds(samples, SAMPLE_RATE, start)
  report(start)
  for (let i = 0; i + 1 < bounds.length; i++) {
    const [from, to] = [bounds[i], bounds[i + 1]]
    const piece = path.join(temp, 'piece.wav')
    await fs.writeFile(piece, wavFromPcm(samples.subarray(from, to)))
    const offset = (from / SAMPLE_RATE) * 1000
    // The end of what came before, so the next piece goes on in the same words and spelling.
    const before = segments
      .map((s) => s.text)
      .join('')
      .slice(-200)
      .trim()
    const found = await engine.transcribe(piece, {
      model: job.model,
      language: job.language,
      file: true,
      signal: job.signal,
      ...(before && { prompt: before }),
      onProgress: (p) => report(from + ((to - from) * p) / 100)
    })
    segments = [
      ...segments,
      ...found.map((s) => ({ ...s, from: s.from + offset, to: s.to + offset }))
    ]
    if (checkpoint) await writeCheckpoint(checkpoint, { done: to, segments })
    report(to)
  }
  return segments
}

/**
 * A video or audio recording of a lecture to a transcript note in `folder`, with the sound
 * kept as a small opus file next to it. Returns the note's vault path.
 */
export async function transcribeFile(
  vault: Vault,
  engine: Transcriber,
  job: FileJob,
  now = new Date()
): Promise<string> {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'marginalia-file-'))
  const wav = path.join(temp, 'audio.wav')
  const opus = path.join(temp, 'audio.webm')
  try {
    await extractAudio(job.source, wav, opus, job.signal, (p, read) =>
      p === null ? job.onProgress('reading', 0, { read }) : job.onProgress('reading', p)
    )
    // Which slide the video shows when, for the slide links (only for a video).
    let timeline = job.timeline
    if (job.slides?.length) {
      const frames = await extractFrames(job.source, job.signal, (p) =>
        job.onProgress('matching', p)
      )
      if (frames.length) timeline = await matchInWorker(frames, job.slides)
    }
    const checkpoint =
      job.checkpoints &&
      (await checkpointFile(job.checkpoints, job.source, job.model, job.language))
    const segments = await transcribeInPieces(engine, job, wav, path.dirname(wav), checkpoint)
    job.onProgress('writing', 100)
    let transcript: string
    let header: string
    if (job.into) {
      // A recording made in the app: its note and audio exist; the text replaces the rest.
      transcript = job.into
      header = headerOf(await vault.readText(transcript)) ?? ''
    } else {
      transcript = await vault.createNote(job.folder, transcriptName(now))
      const audio = await vault.copyAsset(transcript, `recording-${timestamp(now)}.webm`, opus)
      header = transcriptHeader({
        date: now,
        source: `Transcribed from ${path.basename(job.source)}. Times are from the start of the recording.`,
        audio
      })
    }
    const body = paragraphs(segments)
      .map((p) => {
        const slide = timeline && slideAt(timeline, p.at)
        const marker = slide ? slideMarker(transcript, slide.pdf, slide.page) : undefined
        return transcriptParagraph(p.at, p.segments, marker)
      })
      .join('')
    await vault.writeText(transcript, header + body)
    if (checkpoint) await fs.rm(checkpoint, { force: true })
    return transcript
  } finally {
    await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined)
  }
}
