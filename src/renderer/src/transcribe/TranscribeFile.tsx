import { useState } from 'react'
import { TRANSCRIBE_LANGUAGES, type TranscribeLanguage } from '../../../shared/settings'
import type { TranscribeJob } from '../../../shared/types'
import { useApp } from '../store'
import { useFiles } from './files'

const MODELS = [
  {
    value: 'accurate' as const,
    name: 'Accurate',
    help: 'Takes about as long as the recording. Best for Dutch and noisy rooms.'
  },
  {
    value: 'small' as const,
    name: 'Fast',
    help: 'Takes about a quarter of the recording. Fine for clear English.'
  }
]

/** Fast or accurate, and the language, before a recording file is transcribed. */
export function TranscribeFileDialog(): React.JSX.Element | null {
  const choosing = useFiles((s) => s.choosing)
  const settings = useApp((s) => s.settings)
  const [model, setModel] = useState(settings.transcribeModel)
  const [language, setLanguage] = useState<TranscribeLanguage>(settings.transcribeLanguage)
  if (!choosing) return null
  const name = choosing.source.split(/[\\/]/).pop()
  const close = (): void => useFiles.getState().cancelChoice()

  return (
    <div className="overlay-backdrop" onMouseDown={close}>
      <div
        className="transcribe-dialog"
        role="dialog"
        aria-label="Transcribe a recording"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <h2>Transcribe {name}</h2>
        <p className="muted">
          It runs in the background; the transcript appears in {choosing.folder.split('/').pop()}.
          The video itself stays where it is.
        </p>
        <div role="radiogroup" aria-label="Speed">
          {MODELS.map((m) => (
            <label key={m.value} className="transcribe-choice">
              <input
                type="radio"
                name="model"
                checked={model === m.value}
                onChange={() => setModel(m.value)}
              />
              <span>
                <strong>{m.name}</strong>
                <span className="muted">{m.help}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="transcribe-language">
          Spoken language
          <select
            className="toolbar-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value as TranscribeLanguage)}
          >
            {TRANSCRIBE_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <div className="transcribe-actions">
          <button className="text-button" onClick={close}>
            Cancel
          </button>
          <button
            className="button primary"
            autoFocus
            onClick={() => void useFiles.getState().confirm(model, language)}
          >
            Transcribe
          </button>
        </div>
      </div>
    </div>
  )
}

const PHASES: Record<TranscribeJob['phase'], string> = {
  waiting: 'waiting for the one before it',
  downloading: 'downloading the accurate model',
  reading: 'reading the sound',
  transcribing: 'transcribing',
  writing: 'writing the transcript'
}

/** Progress of recording files being transcribed, under the recording bar. */
export function TranscribeJobs(): React.JSX.Element | null {
  const jobs = useFiles((s) => s.jobs)
  if (!jobs.length) return null
  const { cancel, dismiss } = useFiles.getState()

  return (
    <>
      {jobs.map((job) => (
        <div key={job.id} className="recording-bar" role="status" aria-label="Transcribing">
          <span className="recording-time">{job.name}</span>
          {job.error ? (
            <span className="recording-progress error">{job.error}</span>
          ) : job.transcript ? (
            <span className="recording-progress">Transcript ready</span>
          ) : (
            <>
              <span className="recording-level" aria-hidden>
                <span style={{ width: `${job.percent}%` }} />
              </span>
              <span className="recording-progress">
                {PHASES[job.phase]}
                {job.phase !== 'waiting' && job.phase !== 'writing' ? ` ${job.percent}%` : ''}
              </span>
            </>
          )}
          {job.transcript && (
            <button
              className="text-button"
              onClick={() => {
                useApp.getState().openFile(job.transcript!)
                dismiss(job.id)
              }}
            >
              Show transcript
            </button>
          )}
          {job.transcript || job.error ? (
            <button className="button" onClick={() => dismiss(job.id)}>
              Close
            </button>
          ) : (
            <button className="button" onClick={() => cancel(job.id)}>
              Cancel
            </button>
          )}
        </div>
      ))}
    </>
  )
}
