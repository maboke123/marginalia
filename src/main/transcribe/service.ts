import { app, BrowserWindow, dialog } from 'electron'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import type {
  LiveChunk,
  TranscribeFileRequest,
  TranscribeJob,
  TranscribePart,
  TranscribeStatus
} from '../../shared/types'
import type { Handle } from '../ipc'
import { VaultError } from '../vault/names'
import type { Vault } from '../vault/vault'
import { PARTS, WhisperEngine, type Transcriber } from './engine'
import { transcribeFile } from './fileJob'
import { LiveSession } from './live'
import type { Segment } from './transcript'

/**
 * For UI tests: answers at once with numbered sentences instead of running whisper.
 * MARGINALIA_FAKE_WHISPER=missing starts with nothing installed, to test the setup.
 */
class FakeTranscriber implements Transcriber {
  private count = 0

  constructor(private installed: boolean) {}

  async status(): Promise<TranscribeStatus> {
    const parts = Object.keys(PARTS) as TranscribePart[]
    return {
      installed: Object.fromEntries(parts.map((p) => [p, this.installed])) as Record<
        TranscribePart,
        boolean
      >,
      sizes: Object.fromEntries(parts.map((p) => [p, PARTS[p].size])) as Record<
        TranscribePart,
        number
      >
    }
  }

  async install(
    parts: TranscribePart[],
    onProgress: (part: TranscribePart, done: number) => void
  ): Promise<void> {
    for (const part of parts) onProgress(part, PARTS[part].size)
    this.installed = true
  }

  async transcribe(wav: string, options: { language: string }): Promise<Segment[]> {
    const seconds = ((await fs.stat(wav)).size - 44) / 32_000
    this.count++
    return [
      {
        from: 0,
        to: seconds * 1000,
        text: ` Spoken part ${this.count}, ${seconds.toFixed(0)} seconds, language ${options.language}.`
      }
    ]
  }
}

// What ffmpeg can read that a lecture recording is likely to be.
export const MEDIA_EXTENSIONS = [
  'mp4',
  'mkv',
  'mov',
  'webm',
  'avi',
  'm4a',
  'mp3',
  'wav',
  'ogg',
  'opus',
  'flac',
  'aac'
]

/** Speech to text (SPEC addition): live lecture recording into a transcript note. */
export function registerTranscription(
  handle: Handle,
  getWindow: () => BrowserWindow | null,
  dataDir: string,
  getVault: () => Vault | null
): void {
  const engine: Transcriber = process.env['MARGINALIA_FAKE_WHISPER']
    ? new FakeTranscriber(process.env['MARGINALIA_FAKE_WHISPER'] !== 'missing')
    : new WhisperEngine(
        // Shipped with the app; in development the copy scripts/whisper-resources.mjs makes.
        app.isPackaged
          ? path.join(process.resourcesPath, 'whisper')
          : path.join(app.getAppPath(), 'resources', 'whisper'),
        path.join(dataDir, 'whisper')
      )
  let live: LiveSession | null = null
  const send = (channel: string, value: unknown): void =>
    getWindow()?.webContents.send(channel, value)

  handle('transcribe:status', () => engine.status())
  handle('transcribe:install', (parts: TranscribePart[]) =>
    engine.install(parts, (part, done) => send('transcribe:install-progress', { part, done }))
  )

  handle('record:start', async (folder: string) => {
    if (live) throw new VaultError('A recording is already running')
    const vault = getVault()
    if (!vault) throw new VaultError('No vault is open')
    live = await LiveSession.start(vault, engine, folder, (status) => send('record:status', status))
    return live.transcript
  })
  handle('record:audio', async (data: Uint8Array) => {
    await live?.addAudio(data)
  })
  handle('record:chunk', (chunk: LiveChunk) => live?.addChunk(chunk))
  handle('record:stop', async () => {
    const session = live
    live = null
    await session?.stop()
  })

  // Recordings from a file, one at a time: whisper already uses half the cores.
  const jobs = new Map<string, { job: TranscribeJob; abort: AbortController }>()
  let queue: Promise<void> = Promise.resolve()
  const update = (id: string, change: Partial<TranscribeJob>): void => {
    const entry = jobs.get(id)
    if (!entry) return
    entry.job = { ...entry.job, ...change }
    send('transcribe:job', entry.job)
  }

  handle('transcribe:pickRecording', async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Transcribe a recording',
      properties: ['openFile'],
      filters: [{ name: 'Video or audio', extensions: MEDIA_EXTENSIONS }]
    }
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0]
  })

  handle('transcribe:file', (request: TranscribeFileRequest) => {
    const vault = getVault()
    if (!vault) throw new VaultError('No vault is open')
    const id = randomUUID()
    const abort = new AbortController()
    const job: TranscribeJob = {
      id,
      name: path.basename(request.source),
      folder: request.folder,
      phase: 'waiting',
      percent: 0
    }
    jobs.set(id, { job, abort })
    send('transcribe:job', job)
    queue = queue.then(async () => {
      if (abort.signal.aborted) return
      try {
        const transcript = await transcribeFile(vault, engine, {
          ...request,
          signal: abort.signal,
          onProgress: (phase, percent) => update(id, { phase, percent: Math.round(percent) })
        })
        update(id, { transcript, phase: 'writing', percent: 100 })
      } catch (err) {
        update(id, { error: abort.signal.aborted ? 'Cancelled' : (err as Error).message })
      } finally {
        jobs.delete(id)
      }
    })
    return id
  })

  handle('transcribe:cancel', (id: string) => {
    const entry = jobs.get(id)
    if (!entry) return
    entry.abort.abort()
    update(id, { error: 'Cancelled' })
    jobs.delete(id)
  })

  // Quitting mid-lecture keeps the audio; chunks still waiting are skipped.
  app.on('before-quit', () => {
    void live?.cancel()
    for (const { abort } of jobs.values()) abort.abort()
  })
}
