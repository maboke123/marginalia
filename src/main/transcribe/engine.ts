import { execFile, spawn } from 'child_process'
import { createHash } from 'crypto'
import { createWriteStream, promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import type { TranscribePart, TranscribeStatus } from '../../shared/types'
import partsJson from './parts.json'
import type { Segment } from './transcript'

/**
 * whisper.cpp and its models, pinned by hash. The program, the small model and the VAD model
 * ship with the app (scripts/whisper-resources.mjs puts them in the installer); the accurate
 * model is downloaded the first time it is used. The BLAS build was fastest on this CPU.
 */
export const PARTS: Record<
  TranscribePart,
  { url: string; file: string; size: number; sha256: string }
> = partsJson

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

/** Where a part lives inside a whisper folder (the bundled one and the downloads use the same). */
const partPath = (dir: string, part: TranscribePart): string =>
  part === 'program'
    ? path.join(dir, 'bin', 'Release', 'whisper-cli.exe')
    : path.join(dir, 'models', PARTS[part].file)

export class WhisperEngine implements Transcriber {
  /**
   * @param bundled the copy that came with the app (resources/whisper), if any
   * @param downloads where missing parts are downloaded to (in the app's data folder)
   */
  constructor(
    private readonly bundled: string | null,
    private readonly downloads: string
  ) {}

  /** The first complete copy of a part: the bundled one, else a downloaded one. */
  private async locate(part: TranscribePart): Promise<string | null> {
    for (const dir of [this.bundled, this.downloads]) {
      if (!dir) continue
      const file = partPath(dir, part)
      const stat = await fs.stat(file).catch(() => null)
      // The program is unpacked, so only its presence counts; models must be complete.
      if (stat && (part === 'program' || stat.size === PARTS[part].size)) return file
    }
    return null
  }

  private async need(part: TranscribePart): Promise<string> {
    const file = await this.locate(part)
    if (!file) throw new Error(`Speech to text is missing ${PARTS[part].file}`)
    return file
  }

  async status(): Promise<TranscribeStatus> {
    const parts = Object.keys(PARTS) as TranscribePart[]
    const present = await Promise.all(parts.map(async (p) => !!(await this.locate(p))))
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
    const models = path.join(this.downloads, 'models')
    const bin = path.join(this.downloads, 'bin')
    await fs.mkdir(models, { recursive: true })
    for (const part of parts) {
      if (installed[part]) continue
      const { url, file, sha256 } = PARTS[part]
      const temp = path.join(models, `${file}.download`)
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
        await fs.mkdir(bin, { recursive: true })
        // Windows' own tar unpacks zip files.
        await run(path.join(process.env['WINDIR'] ?? 'C:\\Windows', 'System32', 'tar.exe'), [
          '-xf',
          temp,
          '-C',
          bin
        ])
        await fs.rm(temp, { force: true })
      } else {
        await fs.rename(temp, partPath(this.downloads, part))
      }
    }
  }

  async transcribe(wav: string, options: TranscribeOptions): Promise<Segment[]> {
    const out = `${wav}.result`
    const [cli, model, vad] = await Promise.all([
      this.need('program'),
      this.need(options.model),
      this.need('vad')
    ])
    const args = [
      '-m',
      model,
      '-f',
      wav,
      '-l',
      options.language,
      // Half the cores, so the laptop stays usable during a lecture.
      '-t',
      String(Math.max(2, Math.floor(os.cpus().length / 2))),
      '--vad',
      '--vad-model',
      vad,
      '-oj',
      '-of',
      out,
      '-np',
      '-pp'
    ]
    if (options.prompt) args.push('--prompt', options.prompt)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(cli, args, { windowsHide: true, signal: options.signal })
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
