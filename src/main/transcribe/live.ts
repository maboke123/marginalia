import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import type { LiveChunk, RecordingStatus } from '../../shared/types'
import { timestamp, type Vault } from '../vault/vault'
import type { Transcriber } from './engine'
import {
  NOT_TRANSCRIBED,
  transcriptHeader,
  transcriptName,
  transcriptParagraph,
  type SlideMoment
} from './transcript'
import { SAMPLE_RATE, wavFromPcm } from './wav'

/** The slide timeline of a recording: `recording-<time>.json` next to its audio. */
export const timelineName = (audio: string): string => audio.replace(/\.[^.]+$/, '.json')

/**
 * A lecture being recorded: the renderer sends ~30 s chunks of 16 kHz audio, which are
 * transcribed one after another and added to the transcript note as they finish. The
 * compressed audio is kept next to it, so nothing is lost if transcription falls behind.
 */
export class LiveSession {
  private queue: Promise<void> = Promise.resolve()
  private audioWrites: Promise<unknown> = Promise.resolve()
  private readonly abort = new AbortController()
  private pending = 0
  private transcribedTo = 0
  private error: string | null = null
  private readonly timeline: SlideMoment[] = []
  private timelineWrites: Promise<unknown> = Promise.resolve()

  private constructor(
    private readonly vault: Vault,
    private readonly engine: Transcriber,
    readonly transcript: string,
    readonly audioName: string,
    private readonly notify: (status: RecordingStatus) => void
  ) {}

  static async start(
    vault: Vault,
    engine: Transcriber,
    folder: string,
    notify: (status: RecordingStatus) => void,
    live: boolean,
    now = new Date()
  ): Promise<LiveSession> {
    const transcript = await vault.createNote(folder, transcriptName(now))
    const audioName = `recording-${timestamp(now)}.webm`
    const header = transcriptHeader({
      date: now,
      source: 'Recorded live with the microphone. Times are from the start of the recording.',
      audio: `assets/${audioName}`
    })
    // Recorded without live transcription, it is transcribed afterwards.
    await vault.writeText(transcript, live ? header : `${header}\n${NOT_TRANSCRIBED}\n`)
    return new LiveSession(vault, engine, transcript, audioName, notify)
  }

  /** Which slide I had open from now on; kept next to the audio for transcribing later. */
  addSlide(moment: SlideMoment): Promise<unknown> {
    this.timeline.push(moment)
    const data = JSON.stringify({ slides: this.timeline }, null, 1)
    this.timelineWrites = this.timelineWrites.then(() =>
      this.vault.writeAsset(this.transcript, timelineName(this.audioName), data)
    )
    return this.timelineWrites
  }

  /** The kept audio, in the order the recorder made it. */
  addAudio(data: Uint8Array): Promise<unknown> {
    this.audioWrites = this.audioWrites.then(() =>
      this.vault.appendAsset(this.transcript, this.audioName, data)
    )
    return this.audioWrites
  }

  addChunk(chunk: LiveChunk): void {
    this.pending++
    this.report()
    this.queue = this.queue.then(() => this.transcribe(chunk))
  }

  private async transcribe(chunk: LiveChunk): Promise<void> {
    const wav = path.join(os.tmpdir(), `marginalia-chunk-${process.pid}-${Date.now()}.wav`)
    try {
      if (this.abort.signal.aborted) return
      const samples = new Int16Array(
        chunk.pcm.buffer,
        chunk.pcm.byteOffset,
        Math.floor(chunk.pcm.byteLength / 2)
      )
      await fs.writeFile(wav, wavFromPcm(samples))
      const segments = await this.engine.transcribe(wav, {
        model: 'small',
        language: chunk.language,
        prompt: chunk.prompt,
        signal: this.abort.signal
      })
      const paragraph = transcriptParagraph(chunk.at, segments, chunk.marker)
      if (paragraph) await this.vault.appendText(this.transcript, paragraph)
      this.transcribedTo = chunk.at + samples.length / SAMPLE_RATE
      this.error = null
    } catch (err) {
      if (!this.abort.signal.aborted) this.error = (err as Error).message
    } finally {
      this.pending--
      await fs.rm(wav, { force: true }).catch(() => undefined)
      this.report()
    }
  }

  private report(): void {
    this.notify({
      transcript: this.transcript,
      pending: this.pending,
      transcribedTo: this.transcribedTo,
      error: this.error
    })
  }

  /** Waits until every chunk sent so far is in the transcript. */
  async stop(): Promise<void> {
    await this.queue
    await this.audioWrites
    await this.timelineWrites
  }

  /** The app is closing: keep the audio, skip what was not transcribed yet. */
  async cancel(): Promise<void> {
    this.abort.abort()
    await this.audioWrites.catch(() => undefined)
  }
}
