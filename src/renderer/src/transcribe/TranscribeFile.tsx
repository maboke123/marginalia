import { useState } from 'react'
import { TRANSCRIBE_LANGUAGES, type TranscribeLanguage } from '../../../shared/settings'
import type { TranscribeJob } from '../../../shared/types'
import { useApp } from '../store'
import { useFiles, VIDEO_FILE } from './files'
import { clock } from './clock'

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
  const [linkSlides, setLinkSlides] = useState(true)
  if (!choosing) return null
  const file = (p: string): string => p.split(/[\\/]/).pop()!
  const title =
    choosing.kind === 'file'
      ? `Transcribe ${file(choosing.source)}`
      : `Transcribe ${file(choosing.note).replace(/\.md$/, '')}`
  const where =
    choosing.kind === 'file'
      ? `the transcript appears in ${file(choosing.folder)}. The video itself stays where it is.`
      : 'the text goes into this transcript, with links to the slides you had open.'
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
        <h2>{title}</h2>
        <p className="muted">It runs in the background; {where}</p>
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
        {choosing.kind === 'file' && VIDEO_FILE.test(choosing.source) && (
          <label className="transcribe-choice">
            <input
              type="checkbox"
              checked={linkSlides}
              onChange={(e) => setLinkSlides(e.target.checked)}
            />
            <span>
              <strong>Link to the slides in the video</strong>
              <span className="muted">
                Finds which slide is shown when, also in other lessons of this course.
              </span>
            </span>
          </label>
        )}
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
            onClick={() => void useFiles.getState().confirm(model, language, linkSlides)}
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
  reading: 'reading the recording',
  matching: 'finding the slides in the video',
  transcribing: 'transcribing',
  writing: 'writing the transcript'
}

function progressText(job: TranscribeJob): string {
  const phase = PHASES[job.phase]
  if (job.read !== undefined) return `${phase}, ${clock(job.read)} so far`
  if (job.phase === 'waiting' || job.phase === 'writing') return phase
  return `${phase} ${job.percent}%`
}

/** Progress of recording files being transcribed, under the recording bar. */
export function TranscribeJobs(): React.JSX.Element | null {
  const jobs = useFiles((s) => s.jobs)
  const offers = useFiles((s) => s.offers)
  if (!jobs.length && !offers.length) return null
  const { cancel, dismiss, transcribeRecorded, dismissOffer } = useFiles.getState()

  return (
    <>
      {offers.map((note) => (
        <div key={note} className="recording-bar" role="status" aria-label="Recording saved">
          <span className="recording-time">Recording saved</span>
          <span className="recording-progress">
            Transcribe it now, or later from the transcript&apos;s menu in the sidebar.
          </span>
          <button className="button primary" onClick={() => transcribeRecorded(note)}>
            Transcribe now
          </button>
          <button className="button" onClick={() => dismissOffer(note)}>
            Later
          </button>
        </div>
      ))}
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
              <span className="recording-progress">{progressText(job)}</span>
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
