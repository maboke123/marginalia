import { useEffect, useState } from 'react'
import { TRANSCRIBE_LANGUAGES, type TranscribeLanguage } from '../../../shared/settings'
import { useApp } from '../store'
import { clock } from './clock'
import { useRecording } from './recording'

/** How long the current recording has been going, updated every second. */
export function RecordingClock({ startedAt }: { startedAt: number }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return <>{clock((now - startedAt) / 1000)}</>
}

/** Shown across the top of the window while a lecture is recorded, unless I hid it. */
export function RecordingBar(): React.JSX.Element | null {
  const active = useRecording((s) => s.active)
  const status = useRecording((s) => s.status)
  const level = useRecording((s) => s.level)
  const stopping = useRecording((s) => s.stopping)
  const preparing = useRecording((s) => s.preparing)
  const language = useApp((s) => s.settings.transcribeLanguage)
  const live = useApp((s) => s.settings.transcribeLive)
  const shown = useApp((s) => s.settings.recordingBar)
  const silent = useRecording((s) => s.micSilent)

  if (preparing !== null) {
    return (
      <div className="recording-bar" role="status" aria-label="Recording">
        <span className="recording-progress">Getting speech to text ready... {preparing}%</span>
      </div>
    )
  }
  // A failure or a silent microphone still shows, also when the bar is hidden.
  if (!active || (!shown && !status?.error && !silent)) return null
  const pending = status?.pending ?? 0
  const progress = stopping
    ? 'Finishing...'
    : !live
      ? 'Saving the audio and which slide is open; transcribe it afterwards in any language'
      : status?.transcribedTo
        ? `Transcript up to ${clock(status.transcribedTo)}${pending > 1 ? `, ${pending} parts waiting` : ''}`
        : 'The first text appears after about half a minute'

  return (
    <div className="recording-bar" role="status" aria-label="Recording">
      <span className="recording-dot" aria-hidden />
      <span className="recording-time">
        Recording <RecordingClock startedAt={active.startedAt} />
      </span>
      <span className="recording-level" aria-hidden>
        <span style={{ width: `${Math.round(level * 100)}%` }} />
      </span>
      {silent ? (
        <span className="recording-progress error">
          No sound from the microphone. Is it muted?{' '}
          <button className="text-button" onClick={() => void useRecording.getState().unmute()}>
            Unmute
          </button>
        </span>
      ) : (
        <span className={status?.error ? 'recording-progress error' : 'recording-progress'}>
          {status?.error ? `Transcription failed: ${status.error}` : progress}
        </span>
      )}
      <label
        className="recording-live"
        title="Transcribe while recording. Uses more battery and can make the laptop warm."
      >
        <input
          type="checkbox"
          checked={live}
          onChange={(e) =>
            void useApp.getState().saveSettings({ transcribeLive: e.target.checked })
          }
        />
        Live transcript
      </label>
      {/* Without a live transcript the language is chosen when the audio is transcribed. */}
      {live && (
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
      )}
      <button className="text-button" onClick={() => useApp.getState().openFile(active.transcript)}>
        Show transcript
      </button>
      <button
        className="text-button"
        title="Hide this bar. The record buttons show the time; click it to bring the bar back."
        onClick={() => void useApp.getState().saveSettings({ recordingBar: false })}
      >
        Hide
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
