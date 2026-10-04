import { create } from 'zustand'
import type { TranscribeJob } from '../../../shared/types'
import { useApp } from '../store'
import { lessonFolder } from './recording'

/** What ffmpeg can read that a lecture recording is likely to be (as in main's service.ts). */
export const MEDIA_FILE = /\.(mp4|mkv|mov|webm|avi|m4a|mp3|wav|ogg|opus|flac|aac)$/i

interface FilesState {
  /** Recording files being transcribed, and finished ones until dismissed. */
  jobs: TranscribeJob[]
  /** A file waiting for the choice between fast and accurate. */
  choosing: { folder: string; source: string } | null
  /** Starts with a file (dropped) or asks for one; the transcript goes to `folder`. */
  transcribe(folder?: string | null, source?: string): Promise<void>
  confirm(model: 'small' | 'accurate', language: string): Promise<void>
  cancelChoice(): void
  cancel(id: string): void
  dismiss(id: string): void
}

export const useFiles = create<FilesState>((set, get) => {
  window.api.transcribe.onJob((job) => {
    const others = get().jobs.filter((j) => j.id !== job.id)
    set({ jobs: [...others, job] })
    if (job.transcript) void useApp.getState().refresh()
  })

  return {
    jobs: [],
    choosing: null,

    async transcribe(folder, source) {
      const { showError } = useApp.getState()
      const target = folder ?? lessonFolder()
      if (!target) {
        showError('Open a lesson first, so the transcript knows where to go')
        return
      }
      const file = source ?? (await window.api.transcribe.pickRecording())
      if (!file) return
      set({ choosing: { folder: target, source: file } })
    },

    async confirm(model, language) {
      const choice = get().choosing
      if (!choice) return
      set({ choosing: null })
      const app = useApp.getState()
      void app.saveSettings({ transcribeModel: model })
      try {
        await window.api.transcribe.transcribeFile({ ...choice, model, language })
      } catch (err) {
        app.showError(`Could not transcribe: ${(err as Error).message}`)
      }
    },

    cancelChoice: () => set({ choosing: null }),
    cancel: (id) => void window.api.transcribe.cancelJob(id),
    dismiss: (id) => set({ jobs: get().jobs.filter((j) => j.id !== id) })
  }
})
