import { create } from 'zustand'
import type { RecordingStatus, TranscribePart } from '../../../shared/types'
import { slideLink } from '../editor/links'
import { openPdf } from '../lib/open'
import { findNode, isFolder, parentOf } from '../lib/tree'
import { pageText } from '../pdf/text'
import { useApp } from '../store'
import { toPcm16, type Chunk } from './chunker'
import { startMicrophone, type Microphone } from './recorder'

/** What a live recording needs; these ship with the app, so normally nothing is missing. */
const LIVE_PARTS: TranscribePart[] = ['program', 'vad', 'small']

// Whisper's prompt holds about 220 tokens; the start of the slide is the useful part.
const PROMPT_CHARS = 600

interface RecordingState {
  /** The recording going on, if any. */
  active: { transcript: string; startedAt: number } | null
  status: RecordingStatus | null
  /** Microphone loudness, 0 to 1. */
  level: number
  stopping: boolean
  /** Percent of a download of missing parts before recording starts (only in development). */
  preparing: number | null
  toggle(): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  /** The window is closing: keep the audio, do not wait for the transcript to catch up. */
  abandon(): Promise<void>
}

/** The lesson being worked on: the folder of the slides or note on screen. */
function lessonFolder(): string | null {
  const { lectureMode, slidesFile, summaryFile, activeFile, selected, nodes } = useApp.getState()
  const file = lectureMode ? (slidesFile ?? summaryFile) : activeFile
  if (file) return parentOf(file)
  const node = selected ? findNode(nodes, selected) : null
  if (!node) return null
  return isFolder(node) ? node.path : parentOf(node.path)
}

/** The slide on screen right now, as a link from the transcript plus its text. */
async function slideNow(transcript: string): Promise<{ marker?: string; prompt?: string }> {
  const view = useApp.getState().pdfView
  if (!view) return {}
  const marker = slideLink(transcript, view.path, view.page)
  const open = openPdf(view.path)
  const text = open ? await pageText(open.pdf, view.page).catch(() => '') : ''
  return { marker, prompt: text.replace(/\s+/g, ' ').trim().slice(0, PROMPT_CHARS) || undefined }
}

let microphone: Microphone | null = null

export const useRecording = create<RecordingState>((set, get) => {
  window.api.transcribe.onStatus((status) => set({ status }))
  // Bytes per part of a download in progress, for the percentage.
  let downloading: { sizes: Record<string, number>; done: Record<string, number> } | null = null
  window.api.transcribe.onInstallProgress((part, done) => {
    if (!downloading) return
    downloading.done[part] = done
    const total = Object.values(downloading.sizes).reduce((a, b) => a + b, 0)
    const got = Object.values(downloading.done).reduce((a, b) => a + b, 0)
    set({ preparing: Math.round((got / total) * 100) })
  })

  return {
    active: null,
    status: null,
    level: 0,
    stopping: false,
    preparing: null,

    toggle: () => (get().active ? get().stop() : get().start()),

    async start() {
      if (get().active || get().stopping || get().preparing !== null) return
      const { showError, refresh } = useApp.getState()
      const folder = lessonFolder()
      if (!folder) {
        showError('Open a lesson first, so the transcript knows where to go')
        return
      }
      const status = await window.api.transcribe.status()
      const missing = LIVE_PARTS.filter((p) => !status.installed[p])
      if (missing.length) {
        downloading = {
          sizes: Object.fromEntries(missing.map((p) => [p, status.sizes[p]])),
          done: {}
        }
        set({ preparing: 0 })
        try {
          await window.api.transcribe.install(missing)
        } catch (err) {
          showError(`Speech to text could not be set up: ${(err as Error).message}`)
          return
        } finally {
          downloading = null
          set({ preparing: null })
        }
      }

      // The slide on screen when a chunk starts is the one it is about.
      let session: Promise<string> | null = null
      let slide: Promise<{ marker?: string; prompt?: string }> = Promise.resolve({})
      const send = async (chunk: Chunk): Promise<void> => {
        const transcript = await session!
        const { marker, prompt } = await slide
        slide = slideNow(transcript)
        await window.api.transcribe.chunk({
          pcm: toPcm16(chunk.samples),
          at: chunk.at,
          language: useApp.getState().settings.transcribeLanguage,
          marker,
          prompt
        })
      }
      try {
        microphone = await startMicrophone({
          onChunk: (chunk) => void send(chunk).catch((err: Error) => showError(err.message)),
          onAudio: async (data) => {
            await session
            await window.api.transcribe.audio(data)
          },
          onLevel: (level) => set({ level })
        })
      } catch (err) {
        showError(`Could not use the microphone: ${(err as Error).message}`)
        return
      }
      try {
        session = window.api.transcribe.start(folder)
        const transcript = await session
        slide = slideNow(transcript)
        set({ active: { transcript, startedAt: Date.now() }, status: null })
        await refresh()
      } catch (err) {
        await microphone.stop().catch(() => undefined)
        microphone = null
        showError(`Could not start recording: ${(err as Error).message}`)
      }
    },

    async stop() {
      if (!get().active || get().stopping) return
      set({ stopping: true })
      try {
        await microphone?.stop()
        microphone = null
        await window.api.transcribe.stop()
        useApp.getState().showNotice('Recording stopped; the transcript is complete')
      } catch (err) {
        useApp.getState().showError(`Recording did not stop cleanly: ${(err as Error).message}`)
      } finally {
        set({ active: null, stopping: false, level: 0 })
      }
    },

    async abandon() {
      await microphone?.stop().catch(() => undefined)
      microphone = null
    }
  }
})
