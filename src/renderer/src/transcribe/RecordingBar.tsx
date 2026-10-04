import { useEffect, useState } from 'react'
import { TRANSCRIBE_LANGUAGES, type TranscribeLanguage } from '../../../shared/settings'
import { useApp } from '../store'
import { useRecording } from './recording'

const pad = (n: number): string => String(n).padStart(2, '0')
const clock = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}

/** Shown across the top of the window while a lecture is recorded. */
export function RecordingBar(): React.JSX.Element | null {
  const active = useRecording((s) => s.active)
  const status = useRecording((s) => s.status)
  const level = useRecording((s) => s.level)
  const stopping = useRecording((s) => s.stopping)
  const preparing = useRecording((s) => s.preparing)
  const language = useApp((s) => s.settings.transcribeLanguage)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])

  if (preparing !== null) {
    return (
      <div className="recording-bar" role="status" aria-label="Recording">
        <span className="recording-progress">Getting speech to text ready... {preparing}%</span>
      </div>
    )
  }
  if (!active) return null
  const elapsed = (now - active.startedAt) / 1000
  const pending = status?.pending ?? 0
  const progress = stopping
    ? 'Finishing the transcript...'
    : status?.transcribedTo
      ? `Transcript up to ${clock(status.transcribedTo)}${pending > 1 ? `, ${pending} parts waiting` : ''}`
      : 'The first text appears after about half a minute'

  return (
    <div className="recording-bar" role="status" aria-label="Recording">
      <span className="recording-dot" aria-hidden />
      <span className="recording-time">Recording {clock(elapsed)}</span>
      <span className="recording-level" aria-hidden>
        <span style={{ width: `${Math.round(level * 100)}%` }} />
      </span>
      <span className={status?.error ? 'recording-progress error' : 'recording-progress'}>
        {status?.error ? `Transcription failed: ${status.error}` : progress}
      </span>
      <select
        className="toolbar-select"
        aria-label="Spoken language"
        title="Language of the lecture, for the parts still to come"
        value={language}
        onChange={(e) =>
          useApp
            .getState()
            .saveSettings({ transcribeLanguage: e.target.value as TranscribeLanguage })
        }
      >
        {TRANSCRIBE_LANGUAGES.map((l) => (
          <option key={l.value} value={l.value}>
            {l.name}
          </option>
        ))}
      </select>
      <button className="text-button" onClick={() => useApp.getState().openFile(active.transcript)}>
        Show transcript
      </button>
      <button
        className="button"
        disabled={stopping}
        title={`Stop recording (${useApp.getState().settings.hotkeys.record})`}
        onClick={() => void useRecording.getState().stop()}
      >
        Stop
      </button>
    </div>
  )
}
