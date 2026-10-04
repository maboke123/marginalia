import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import type { TranscribeJobPhase } from '../../shared/types'
import { VaultError } from '../vault/names'
import { timestamp, type Vault } from '../vault/vault'
import type { Model, Transcriber } from './engine'
import {
  headerOf,
  paragraphs,
  slideAt,
  slideMarker,
  transcriptHeader,
  transcriptName,
  transcriptParagraph,
  type SlideMoment
} from './transcript'

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
  signal: AbortSignal
  onProgress(phase: TranscribeJobPhase, percent: number): void
}

/** "01:23:45.67" -> seconds */
const seconds = (hms: string): number =>
  hms.split(':').reduce((total, part) => total * 60 + Number(part), 0)

/**
 * Reads the sound of a recording with ffmpeg: 16 kHz WAV for whisper, and a small opus copy
 * to keep with the transcript. Reports how far it got.
 */
export function extractAudio(
  source: string,
  wav: string,
  opus: string,
  signal: AbortSignal,
  onProgress: (percent: number) => void
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
      if (at && duration) onProgress(Math.min(100, (seconds(at[1]) / duration) * 100))
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
    await extractAudio(job.source, wav, opus, job.signal, (p) => job.onProgress('reading', p))
    const segments = await engine.transcribe(wav, {
      model: job.model,
      language: job.language,
      signal: job.signal,
      onProgress: (p) => job.onProgress('transcribing', p)
    })
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
        const slide = job.timeline && slideAt(job.timeline, p.at)
        const marker = slide ? slideMarker(transcript, slide.pdf, slide.page) : undefined
        return transcriptParagraph(p.at, p.segments, marker)
      })
      .join('')
    await vault.writeText(transcript, header + body)
    return transcript
  } finally {
    await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined)
  }
}
