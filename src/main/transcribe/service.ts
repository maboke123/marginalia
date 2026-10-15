import { app, BrowserWindow, dialog, powerMonitor, powerSaveBlocker } from 'electron'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import type {
  LiveChunk,
  PendingRecordings,
  TranscribeFileRequest,
  TranscribeRecordedRequest,
  TranscribeJob,
  TranscribePart,
  TranscribeStatus,
  VaultNode
} from '../../shared/types'
import type { ConfigStore } from '../config'
import type { Handle } from '../ipc'
import { VaultError } from '../vault/names'
import type { Vault } from '../vault/vault'
import { PARTS, WhisperEngine, type Transcriber } from './engine'
import { transcribeFile, type FileJob } from './fileJob'
import { pruneCheckpoints } from './pieces'
import { LiveSession, timelineName } from './live'
import { fixMicrophone, type MicFix } from './mic'
import { audioOf, NOT_TRANSCRIBED, type SlideMoment } from './transcript'
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

  async transcribe(
    wav: string,
    options: { language: string; signal?: AbortSignal }
  ): Promise<Segment[]> {
    // MARGINALIA_FAKE_WHISPER_MS: takes this long, so a test can see the queue.
    const delay = Number(process.env['MARGINALIA_FAKE_WHISPER_MS'] ?? 0)
    if (delay) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay)
        options.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('Cancelled'))
        })
      })
    }
    const seconds = ((await fs.stat(wav)).size - 44) / 32_000
    this.count++
    // A longer recording: a sentence every 8 s with a pause between, so it gets paragraphs.
    if (seconds > 10) {
      return Array.from({ length: Math.floor(seconds / 8) }, (_, i) => ({
        from: i * 8000,
        to: i * 8000 + 5000,
        text: ` Sentence ${i + 1}.`
      }))
    }
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

/** Transcript notes recorded in the app, anywhere in the vault. */
function transcriptNotes(nodes: VaultNode[]): string[] {
  return nodes.flatMap((n) =>
    n.children
      ? transcriptNotes(n.children)
      : n.kind === 'markdown' && /^Transcript .*\.md$/.test(n.name)
        ? [n.path]
        : []
  )
}

/** Speech to text (SPEC addition): live lecture recording into a transcript note. */
export function registerTranscription(
  handle: Handle,
  getWindow: () => BrowserWindow | null,
  dataDir: string,
  config: ConfigStore,
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
  void pruneCheckpoints(path.join(dataDir, 'transcribe'))
  const send = (channel: string, value: unknown): void =>
    getWindow()?.webContents.send(channel, value)

  handle('transcribe:status', () => engine.status())
  handle('transcribe:install', (parts: TranscribePart[]) =>
    engine.install(parts, (part, done) => send('transcribe:install-progress', { part, done }))
  )

  // Tests must not touch the real microphone settings.
  handle('record:unmuteMic', (): Promise<MicFix[]> =>
    process.env['MARGINALIA_FAKE_WHISPER'] ? Promise.resolve(['unmuted']) : fixMicrophone()
  )

  handle('record:start', async (folder: string, transcribeLive: boolean) => {
    if (live) throw new VaultError('A recording is already running')
    const vault = getVault()
    if (!vault) throw new VaultError('No vault is open')
    live = await LiveSession.start(
      vault,
      engine,
      folder,
      (status) => send('record:status', status),
      transcribeLive
    )
    return live.transcript
  })
  handle('record:slide', async (moment: SlideMoment) => {
    await live?.addSlide(moment)
  })
  handle('record:audio', async (data: Uint8Array) => {
    await live?.addAudio(data)
  })
  handle('record:chunk', (chunk: LiveChunk) => live?.addChunk(chunk))
  handle('record:stop', async () => {
    const session = live
    live = null
    await session?.stop()
    void transcribePending()
  })

  // Recordings from a file, one at a time: whisper already uses half the cores.
  interface Entry {
    job: TranscribeJob
    vault: Vault
    request: Omit<FileJob, 'signal' | 'onProgress'>
    abort: AbortController
  }
  const jobs = new Map<string, Entry>()
  /** Jobs not started yet, next one first. */
  let waiting: string[] = []
  let running: string | null = null
  /** Transcripts the app must not start by itself again: stopped by hand or failed. */
  const skipped = new Set<string>()
  // A cancelled job sends nothing more: the renderer has already let it go.
  const update = (id: string, change: Partial<TranscribeJob>): void => {
    const entry = jobs.get(id)
    if (!entry || entry.abort.signal.aborted) return
    entry.job = { ...entry.job, ...change }
    send('transcribe:job', entry.job)
  }
  const renumber = (): void => waiting.forEach((id, i) => update(id, { place: i + 1 }))

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

  handle('transcribe:file', (request: TranscribeFileRequest) =>
    queueJob(request, path.basename(request.source))
  )

  handle('transcribe:recorded', (request: TranscribeRecordedRequest) => {
    const vault = getVault()
    if (!vault) throw new VaultError('No vault is open')
    // My own choice of language and model wins over one the app started by itself.
    for (const entry of jobs.values()) {
      if (entry.job.note !== request.note) continue
      if (!entry.job.auto) throw new VaultError('This recording is already being transcribed')
      drop(entry, { removed: true })
    }
    skipped.delete(request.note)
    return queueRecorded(vault, request, false)
  })

  // A recording made in the app: its own audio, filled into its note, slide links from its
  // timeline (written next to the audio while recording).
  async function queueRecorded(
    vault: Vault,
    request: TranscribeRecordedRequest,
    auto: boolean
  ): Promise<string> {
    const note = await vault.readText(request.note)
    const audio = audioOf(note)
    if (!audio) throw new VaultError('This transcript has no recording to transcribe')
    const folder = request.note.split('/').slice(0, -1).join('/')
    const timeline = await vault
      .readAsset(request.note, timelineName(audio.split('/').pop()!))
      .then((text) => (JSON.parse(text) as { slides: SlideMoment[] }).slides)
      .catch(() => undefined)
    return queueJob(
      {
        folder,
        source: vault.resolve(`${folder}/${audio}`),
        model: request.model,
        language: request.language,
        into: request.note,
        timeline
      },
      request.note.split('/').pop()!.replace(/\.md$/, ''),
      { note: request.note, auto }
    )
  }

  function queueJob(
    request: Omit<FileJob, 'signal' | 'onProgress'>,
    name: string,
    extra: Pick<TranscribeJob, 'note' | 'auto'> = {}
  ): string {
    const vault = getVault()
    if (!vault) throw new VaultError('No vault is open')
    const twin = extra.note
      ? [...jobs.values()].find((e) => e.job.note === extra.note && !e.abort.signal.aborted)
      : undefined
    if (twin) return twin.job.id
    const id = randomUUID()
    const job: TranscribeJob = {
      id,
      name,
      folder: request.folder,
      model: request.model,
      language: request.language,
      phase: 'waiting',
      percent: 0,
      place: waiting.length + 1,
      ...extra
    }
    jobs.set(id, { job, vault, request, abort: new AbortController() })
    waiting.push(id)
    send('transcribe:job', job)
    void runNext()
    return id
  }

  async function runNext(): Promise<void> {
    if (running || !waiting.length) return
    const id = waiting.shift()!
    running = id
    renumber()
    const { vault, request, abort, job } = jobs.get(id)!
    // Transcribed meanwhile (by hand, or on another PC through OneDrive): nothing left to do.
    if (job.auto && job.note && !(await untranscribed(vault, job.note))) {
      update(id, { removed: true })
      jobs.delete(id)
      running = null
      void runNext()
      return
    }
    update(id, { phase: 'reading', percent: 0, place: undefined })
    // A laptop on battery sleeps after a few idle minutes, which stopped long jobs halfway.
    const awake = powerSaveBlocker.start('prevent-app-suspension')
    try {
      // The accurate model does not ship with the app; it comes the first time it is used.
      const { installed, sizes } = await engine.status()
      const missing = (['program', 'vad', request.model] as TranscribePart[]).filter(
        (p) => !installed[p]
      )
      if (missing.length) {
        const total = missing.reduce((n, p) => n + sizes[p], 0)
        const done: Partial<Record<TranscribePart, number>> = {}
        await engine.install(missing, (part, bytes) => {
          done[part] = bytes
          const got = Object.values(done).reduce((n, b) => n + (b ?? 0), 0)
          update(id, { phase: 'downloading', percent: Math.round((got / total) * 100) })
        })
      }
      const transcript = await transcribeFile(vault, engine, {
        ...request,
        signal: abort.signal,
        checkpoints: path.join(dataDir, 'transcribe'),
        onProgress: (phase, percent, info = {}) =>
          update(id, {
            phase,
            percent: Math.round(percent),
            read: info.read,
            done: info.done,
            total: info.total,
            resumed: info.resumed
          })
      })
      update(id, { transcript, phase: 'writing', percent: 100 })
    } catch (err) {
      const { job } = jobs.get(id)!
      if (job.auto && job.note && !abort.signal.aborted) skipped.add(job.note)
      update(id, { error: (err as Error).message })
    } finally {
      powerSaveBlocker.stop(awake)
      jobs.delete(id)
      running = null
      void runNext()
    }
  }

  // A waiting job just leaves the queue; the running one stops whisper or ffmpeg, and the
  // next one starts once that has exited.
  handle('transcribe:cancel', (id: string) => {
    const entry = jobs.get(id)
    if (!entry) return
    // Stopped by hand: the app does not start it again by itself until the next launch.
    if (entry.job.auto && entry.job.note) skipped.add(entry.job.note)
    drop(entry)
  })

  /** Stops a job, or takes it out of the queue, after telling the window `last`. */
  function drop(entry: Entry, last?: Partial<TranscribeJob>): void {
    if (last) update(entry.job.id, last)
    entry.abort.abort()
    if (waiting.includes(entry.job.id)) {
      waiting = waiting.filter((w) => w !== entry.job.id)
      jobs.delete(entry.job.id)
      renumber()
    }
  }

  // Recordings saved without transcribing them are done while the laptop is plugged in, in the
  // language of their course. Unplugged, those jobs stop; their checkpoints keep the progress.
  const queuedNote = (note: string): boolean =>
    [...jobs.values()].some((e) => e.job.note === note && !e.abort.signal.aborted)

  const untranscribed = async (vault: Vault, note: string): Promise<boolean> => {
    const text = await vault.readText(note).catch(() => '')
    return text.includes(NOT_TRANSCRIBED) && !!audioOf(text)
  }

  /** The order I put recordings in that are not started yet; others follow in tree order. */
  let pendingOrder: string[] = []

  /** Saved recordings not transcribed yet and not in the queue, in the order they start. */
  async function pendingNotes(vault: Vault): Promise<string[]> {
    const notes: string[] = []
    for (const note of transcriptNotes((await vault.tree()).nodes)) {
      if (note === live?.transcript || queuedNote(note)) continue
      if (await untranscribed(vault, note)) notes.push(note)
    }
    const rank = (note: string): number => {
      const i = pendingOrder.indexOf(note)
      return i === -1 ? pendingOrder.length : i
    }
    return notes.sort((a, b) => rank(a) - rank(b))
  }

  // Several triggers can come at once (plugging in, a recording ending, a setting changing);
  // two scans side by side queued every recording twice.
  let scan: Promise<void> | null = null
  function transcribePending(now = false, only?: string[]): Promise<void> {
    scan = (scan ?? Promise.resolve()).catch(() => undefined).then(() => scanPending(now, only))
    return scan
  }

  /**
   * `now`: started by hand, so also on battery and when the setting is off; `only`: just
   * these recordings.
   */
  async function scanPending(now: boolean, only?: string[]): Promise<void> {
    const vault = getVault()
    if (!vault) return
    if (!now && powerMonitor.isOnBatteryPower()) return
    const { settings } = await config.read()
    if (!now && !settings.autoTranscribe) return
    try {
      const { languages } = await vault.tree()
      for (const note of await pendingNotes(vault)) {
        if (only && !only.includes(note)) continue
        if (!now && skipped.has(note)) continue
        if (queuedNote(note)) continue
        if (now) skipped.delete(note)
        const language = languages[note.split('/')[0]] ?? settings.transcribeLanguage
        // Started by hand they are not auto jobs, so unplugging does not stop them.
        await queueRecorded(vault, { note, model: settings.transcribeModel, language }, !now).catch(
          () => skipped.add(note)
        )
      }
    } catch (err) {
      console.error('Could not look for recordings to transcribe', err)
    }
  }
  handle('transcribe:pending', () => transcribePending())
  handle('transcribe:startPending', (notes?: string[]) => transcribePending(true, notes))
  handle('transcribe:orderPending', (notes: string[]) => {
    pendingOrder = notes
  })
  handle('transcribe:pendingNotes', async (): Promise<PendingRecordings> => {
    const vault = getVault()
    const { settings } = await config.read()
    return {
      notes: vault ? await pendingNotes(vault) : [],
      onBattery: powerMonitor.isOnBatteryPower(),
      auto: settings.autoTranscribe
    }
  })

  const onBattery = (): void => {
    for (const entry of [...jobs.values()]) {
      if (!entry.job.auto) continue
      drop(
        entry,
        entry.job.id === running
          ? {
              error: 'Paused on battery power. It goes on from here once the laptop is plugged in.'
            }
          : { removed: true }
      )
    }
  }
  powerMonitor.on('on-battery', onBattery)
  powerMonitor.on('on-ac', () => void transcribePending())
  setTimeout(() => void transcribePending(), 30_000)
  setInterval(() => void transcribePending(), 5 * 60_000)

  /** Moves a waiting job `by` places, negative is sooner. */
  handle('transcribe:move', (id: string, by: number) => {
    const from = waiting.indexOf(id)
    if (from === -1) return
    const to = Math.max(0, Math.min(waiting.length - 1, from + by))
    waiting.splice(from, 1)
    waiting.splice(to, 0, id)
    renumber()
  })

  // Asleep, the microphone stops and the slide times drift from the audio, so the recording
  // ends there. Also on waking, in case the window could not act before the laptop slept.
  const onSleep = (): void => {
    if (live) send('record:sleep', null)
  }
  powerMonitor.on('suspend', onSleep)
  powerMonitor.on('resume', onSleep)

  // Quitting mid-lecture keeps the audio; chunks still waiting are skipped.
  app.on('before-quit', () => {
    void live?.cancel()
    for (const { abort } of jobs.values()) abort.abort()
  })
}
