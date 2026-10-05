import { create } from 'zustand'
import type { TranscribeJob } from '../../../shared/types'
import { useApp } from '../store'
import { slideCandidates } from './candidates'
import { lessonFolder } from './recording'
import { slideThumbs } from './thumbs'

/** What ffmpeg can read that a lecture recording is likely to be (as in main's service.ts). */
/** Recordings with a picture, so the slides they show can be found. */
export const VIDEO_FILE = /\.(mp4|mkv|mov|webm|avi)$/i

export const MEDIA_FILE = /\.(mp4|mkv|mov|webm|avi|m4a|mp3|wav|ogg|opus|flac|aac)$/i

/** A transcript note made by recording in the app (its name, as the app gives it). */
export const isTranscript = (path: string): boolean => /(^|\/)Transcript [^/]*\.md$/.test(path)

/** What is about to be transcribed: a file from outside, or a recording made in the app. */
export type Choice =
  | { kind: 'file'; folder: string; source: string; pdf?: string }
  | { kind: 'recorded'; note: string }

interface FilesState {
  /** Recordings being transcribed, and finished ones until dismissed. */
  jobs: TranscribeJob[]
  /** Recordings made without live transcription, offered right after they stop. */
  offers: string[]
  /** Waiting for the choice between fast and accurate. */
  choosing: Choice | null
  /**
   * Starts with a file (dropped) or asks for one; the transcript goes to `folder`. Dropped on
   * a PDF, that deck is the one the video is about.
   */
  transcribe(folder?: string | null, source?: string, pdf?: string): Promise<void>
  /** A transcript recorded in the app, from its kept audio. */
  transcribeRecorded(note: string): void
  offer(note: string): void
  dismissOffer(note: string): void
  /** `linkSlides`: find the slides a video shows, for links in the transcript. */
  confirm(model: 'small' | 'accurate', language: string, linkSlides: boolean): Promise<void>
  cancelChoice(): void
  /** Takes a job out of the queue, or stops it if it is running. */
  cancel(id: string): void
  move(id: string, by: number): void
  dismiss(id: string): void
  queueOpen: boolean
  showQueue(open: boolean): void
}

export const useFiles = create<FilesState>((set, get) => {
  // Progress sent just before a cancel reached main must not bring the job back.
  const cancelled = new Set<string>()
  window.api.transcribe.onJob((job) => {
    if (cancelled.has(job.id)) return
    const jobs = get().jobs
    set({
      jobs: jobs.some((j) => j.id === job.id)
        ? jobs.map((j) => (j.id === job.id ? job : j))
        : [...jobs, job]
    })
    if (job.transcript) void useApp.getState().refresh()
  })

  return {
    jobs: [],
    offers: [],
    choosing: null,
    queueOpen: false,

    async transcribe(folder, source, pdf) {
      const { showError } = useApp.getState()
      const target = folder ?? lessonFolder()
      if (!target) {
        showError('Open a lesson first, so the transcript knows where to go')
        return
      }
      const file = source ?? (await window.api.transcribe.pickRecording())
      if (!file) return
      set({ choosing: { kind: 'file', folder: target, source: file, pdf } })
    },

    transcribeRecorded(note) {
      get().dismissOffer(note)
      set({ choosing: { kind: 'recorded', note } })
    },

    offer: (note) => set({ offers: [...get().offers.filter((n) => n !== note), note] }),
    dismissOffer: (note) => set({ offers: get().offers.filter((n) => n !== note) }),

    async confirm(model, language, linkSlides) {
      const choice = get().choosing
      if (!choice) return
      set({ choosing: null })
      const app = useApp.getState()
      void app.saveSettings({ transcribeModel: model })
      try {
        if (choice.kind === 'file') {
          const { folder, source, pdf } = choice
          // Rendered here (pdf.js lives in this window); matched against the video in main.
          const slides =
            linkSlides && VIDEO_FILE.test(source)
              ? await slideThumbs(slideCandidates(app.nodes, { folder, pdf }))
              : undefined
          await window.api.transcribe.transcribeFile({ folder, source, model, language, slides })
        } else {
          await window.api.transcribe.transcribeRecorded({ note: choice.note, model, language })
        }
      } catch (err) {
        app.showError(`Could not transcribe: ${(err as Error).message}`)
      }
    },

    cancelChoice: () => set({ choosing: null }),
    cancel(id) {
      cancelled.add(id)
      void window.api.transcribe.cancelJob(id)
      get().dismiss(id)
    },
    move: (id, by) => void window.api.transcribe.moveJob(id, by),
    showQueue: (queueOpen) => set({ queueOpen }),
    dismiss: (id) => set({ jobs: get().jobs.filter((j) => j.id !== id) })
  }
})
