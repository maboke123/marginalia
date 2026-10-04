import { app, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type { LiveChunk, TranscribePart, TranscribeStatus } from '../../shared/types'
import type { Handle } from '../ipc'
import { VaultError } from '../vault/names'
import type { Vault } from '../vault/vault'
import { PARTS, WhisperEngine, type Transcriber } from './engine'
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

/** Speech to text (SPEC addition): live lecture recording into a transcript note. */
export function registerTranscription(
  handle: Handle,
  getWindow: () => BrowserWindow | null,
  dataDir: string,
  getVault: () => Vault | null
): void {
  const engine: Transcriber = process.env['MARGINALIA_FAKE_WHISPER']
    ? new FakeTranscriber(process.env['MARGINALIA_FAKE_WHISPER'] !== 'missing')
    : new WhisperEngine(path.join(dataDir, 'whisper'))
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

  // Quitting mid-lecture keeps the audio; chunks still waiting are skipped.
  app.on('before-quit', () => {
    void live?.cancel()
  })
}
