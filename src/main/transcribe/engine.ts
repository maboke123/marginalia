import { execFile, spawn } from 'child_process'
import { createHash } from 'crypto'
import { createWriteStream, promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import type { TranscribePart, TranscribeStatus } from '../../shared/types'
import type { Segment } from './transcript'

/**
 * whisper.cpp, downloaded on first use into the app's data folder (not the installer) and
 * checked against these hashes. The BLAS build was the fastest on this laptop's CPU.
 */
export const PARTS: Record<
  TranscribePart,
  { url: string; file: string; size: number; sha256: string }
> = {
  program: {
    url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-blas-bin-x64.zip',
    file: 'whisper-blas-bin-x64.zip',
    size: 21_360_234,
    sha256: '55c06d09e8b9b6cfb2b0b47ddedc71803054f0e48be1f41848b3141c06c703a9'
  },
  // Voice activity detection: skips silence and keeps whisper from dropping sentences.
  vad: {
    url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin',
    file: 'ggml-silero-v5.1.2.bin',
    size: 885_098,
    sha256: '29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf'
  },
  // About 3.5x real time here: fast enough for live recording.
  small: {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin',
    file: 'ggml-small-q5_1.bin',
    size: 190_085_487,
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb'
  },
  // About real time here, but clearly better for Dutch and hard audio: for recordings.
  accurate: {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    file: 'ggml-large-v3-turbo-q5_0.bin',
    size: 574_041_195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2'
  }
}

export type Model = 'small' | 'accurate'

export interface TranscribeOptions {
  model: Model
  /** "nl", "en" or "auto". */
  language: string
  /** Words that are likely to come up, such as the slide's text; helps with spelling. */
  prompt?: string
  /** 0 to 100, for long recordings. */
  onProgress?(percent: number): void
  signal?: AbortSignal
}

/** Something that turns a WAV file into text. Tests use a fake one. */
export interface Transcriber {
  status(): Promise<TranscribeStatus>
  install(
    parts: TranscribePart[],
    onProgress: (part: TranscribePart, done: number) => void
  ): Promise<void>
  transcribe(wav: string, options: TranscribeOptions): Promise<Segment[]>
}

const run = promisify(execFile)

export class WhisperEngine implements Transcriber {
  private readonly models: string
  private readonly bin: string

  constructor(dir: string) {
    this.models = path.join(dir, 'models')
    this.bin = path.join(dir, 'bin')
  }

  private get cli(): string {
    return path.join(this.bin, 'Release', 'whisper-cli.exe')
  }

  private target(part: TranscribePart): string {
    return part === 'program' ? this.cli : path.join(this.models, PARTS[part].file)
  }

  async status(): Promise<TranscribeStatus> {
    const has = async (part: TranscribePart): Promise<boolean> => {
      const stat = await fs.stat(this.target(part)).catch(() => null)
      // The program is unpacked, so only its presence counts; models must be complete.
      return !!stat && (part === 'program' || stat.size === PARTS[part].size)
    }
    const parts = Object.keys(PARTS) as TranscribePart[]
    const present = await Promise.all(parts.map(has))
    return {
      installed: Object.fromEntries(parts.map((p, i) => [p, present[i]])) as Record<
        TranscribePart,
        boolean
      >,
      sizes: Object.fromEntries(parts.map((p) => [p, PARTS[p].size])) as Record<
        TranscribePart,
        number
      >
    }
  }

  /** Downloads what is missing, checks each file's hash, and only then puts it in place. */
  async install(
    parts: TranscribePart[],
    onProgress: (part: TranscribePart, done: number) => void
  ): Promise<void> {
    const { installed } = await this.status()
    await fs.mkdir(this.models, { recursive: true })
    for (const part of parts) {
      if (installed[part]) continue
      const { url, file, sha256 } = PARTS[part]
      const temp = path.join(this.models, `${file}.download`)
      const response = await fetch(url)
      if (!response.ok || !response.body) {
        throw new Error(`Download failed (${response.status}): ${file}`)
      }
      const hash = createHash('sha256')
      const out = createWriteStream(temp)
      let done = 0
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk)
        done += chunk.length
        if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()))
        onProgress(part, done)
      }
      await new Promise<void>((resolve, reject) =>
        out.end((err?: Error) => (err ? reject(err) : resolve()))
      )
      if (hash.digest('hex') !== sha256) {
        await fs.rm(temp, { force: true })
        throw new Error(`${file} did not download correctly; try again`)
      }
      if (part === 'program') {
        await fs.mkdir(this.bin, { recursive: true })
        // Windows' own tar unpacks zip files.
        await run(path.join(process.env['WINDIR'] ?? 'C:\\Windows', 'System32', 'tar.exe'), [
          '-xf',
          temp,
          '-C',
          this.bin
        ])
        await fs.rm(temp, { force: true })
      } else {
        await fs.rename(temp, this.target(part))
      }
    }
  }

  async transcribe(wav: string, options: TranscribeOptions): Promise<Segment[]> {
    const out = `${wav}.result`
    const args = [
      '-m',
      this.target(options.model),
      '-f',
      wav,
      '-l',
      options.language,
      // Half the cores, so the laptop stays usable during a lecture.
      '-t',
      String(Math.max(2, Math.floor(os.cpus().length / 2))),
      '--vad',
      '--vad-model',
      this.target('vad'),
      '-oj',
      '-of',
      out,
      '-np',
      '-pp'
    ]
    if (options.prompt) args.push('--prompt', options.prompt)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.cli, args, { windowsHide: true, signal: options.signal })
      if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
      let errors = ''
      child.stderr.on('data', (data: Buffer) => {
        const text = data.toString()
        errors = (errors + text).slice(-2000)
        for (const m of text.matchAll(/progress = +(\d+)%/g)) options.onProgress?.(Number(m[1]))
      })
      child.on('error', reject)
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`whisper stopped (${code}): ${errors.trim()}`))
      )
    })
    try {
      const result = JSON.parse(await fs.readFile(`${out}.json`, 'utf8')) as {
        transcription: { offsets: { from: number; to: number }; text: string }[]
      }
      return result.transcription.map((t) => ({
        from: t.offsets.from,
        to: t.offsets.to,
        text: t.text
      }))
    } finally {
      await fs.rm(`${out}.json`, { force: true })
    }
  }
}
