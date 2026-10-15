import { useEffect, useState } from 'react'
import { TRANSCRIBE_LANGUAGES, type TranscribeLanguage } from '../../../shared/settings'
import type { PendingRecordings, TranscribeJob } from '../../../shared/types'
import { Icon } from '../components/Icon'
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
  const course =
    choosing && (choosing.kind === 'file' ? choosing.folder : choosing.note).split('/')[0]
  const courseLanguage = useApp((s) => (course ? s.languages[course] : undefined))
  // Each new recording starts in the language of its course.
  const [shown, setShown] = useState(choosing)
  if (shown !== choosing) {
    setShown(choosing)
    if (courseLanguage) setLanguage(courseLanguage)
  }
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
  waiting: 'waiting',
  downloading: 'downloading the accurate model',
  reading: 'reading the recording',
  matching: 'finding the slides in the video',
  transcribing: 'transcribing',
  writing: 'writing the transcript'
}

function progressText(job: TranscribeJob): string {
  const phase = PHASES[job.phase]
  if (job.read !== undefined) return `${phase}, ${clock(job.read)} so far`
  if (job.phase === 'transcribing' && job.total) {
    const at = `${clock(job.done ?? 0)} of ${clock(job.total)}`
    return job.resumed ? `${phase}, ${at} (went on where it stopped)` : `${phase}, ${at}`
  }
  if (job.phase === 'waiting' || job.phase === 'writing') return phase
  return `${phase} ${job.percent}%`
}

const LANGUAGE_NAMES: Record<string, string> = Object.fromEntries(
  TRANSCRIBE_LANGUAGES.map((l) => [l.value, l.name])
)

/** "B2 Decision trees, accurate, Dutch" */
function jobDetails(job: TranscribeJob): string {
  const lesson = job.folder.split('/').pop()
  const model = job.model === 'accurate' ? 'accurate' : 'fast'
  const details = `${lesson}, ${model}, ${LANGUAGE_NAMES[job.language] ?? job.language}`
  return job.auto ? `${details}, started because the laptop is plugged in` : details
}

/**
 * Under the recording bar: the recording being transcribed now, with the queue behind it,
 * and finished ones until they are closed.
 */
function queueOf(jobs: TranscribeJob[]): {
  open: TranscribeJob[]
  current: TranscribeJob | undefined
  waiting: TranscribeJob[]
} {
  const open = jobs.filter((j) => !j.transcript && !j.error)
  const current = open.find((j) => j.phase !== 'waiting')
  const waiting = open
    .filter((j) => j.phase === 'waiting')
    .sort((a, b) => (a.place ?? 0) - (b.place ?? 0))
  return { open, current, waiting }
}

export function TranscribeJobs(): React.JSX.Element | null {
  const jobs = useFiles((s) => s.jobs)
  const offers = useFiles((s) => s.offers)
  if (!jobs.length && !offers.length) return null
  const { cancel, dismiss, transcribeRecorded, dismissOffer, showQueue } = useFiles.getState()
  const { open, current, waiting } = queueOf(jobs)
  const finished = jobs.filter((j) => j.transcript || j.error)

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
      {open.length > 0 && (
        <div className="recording-bar" role="status" aria-label="Transcribing">
          {current ? (
            <>
              <span className="recording-time">{current.name}</span>
              {current.read === undefined && (
                <span className="recording-level" aria-hidden>
                  <span style={{ width: `${current.percent}%` }} />
                </span>
              )}
              <span className="recording-progress">{progressText(current)}</span>
            </>
          ) : (
            <span className="recording-progress">Starting the next transcription</span>
          )}
          <button className="text-button" onClick={() => showQueue(true)}>
            {waiting.length ? `Queue (${waiting.length} waiting)` : 'Queue'}
          </button>
          {current && (
            <button className="button" onClick={() => cancel(current.id)}>
              Cancel
            </button>
          )}
        </div>
      )}
      {finished.map((job) => (
        <div key={job.id} className="recording-bar" role="status" aria-label="Transcribing">
          <span className="recording-time">{job.name}</span>
          {job.error ? (
            <span className="recording-progress error">{job.error}</span>
          ) : (
            <span className="recording-progress">Transcript ready</span>
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
          <button className="button" onClick={() => dismiss(job.id)}>
            Close
          </button>
        </div>
      ))}
    </>
  )
}

const noteName = (note: string): string => note.split('/').pop()!.replace(/.md$/, '')

function notStartedReason({ onBattery, auto }: PendingRecordings): string {
  if (!auto) return 'Transcribing by itself is off in Settings, so these wait until you start them.'
  if (onBattery)
    return 'These start by themselves once the laptop is plugged in, or now on battery.'
  return 'These start by themselves within a few minutes.'
}

/**
 * Every recording still to transcribe: stop the running one, reorder or remove the rest, and
 * start the ones not queued yet (say on battery).
 */
export function TranscribeQueue(): React.JSX.Element | null {
  const queueOpen = useFiles((s) => s.queueOpen)
  return queueOpen ? <QueueDialog /> : null
}

function QueueDialog(): React.JSX.Element {
  const jobs = useFiles((s) => s.jobs)
  const { current, waiting } = queueOf(jobs)
  const { cancel, move, showQueue } = useFiles.getState()
  const [pending, setPending] = useState<PendingRecordings | null>(null)
  const [starting, setStarting] = useState(false)
  const queued = jobs.map((j) => j.id).join()

  useEffect(() => {
    let live = true
    void window.api.transcribe
      .pendingNotes()
      .then((p) => live && setPending(p))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [queued])

  const startAll = (): void => {
    setStarting(true)
    void window.api.transcribe
      .startPending()
      .then(() => window.api.transcribe.pendingNotes())
      .then(setPending)
      .catch((err) => useApp.getState().showError((err as Error).message))
      .finally(() => setStarting(false))
  }

  const close = (): void => showQueue(false)
  const [dragged, setDragged] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null)

  const dropOn = (e: React.DragEvent, id: string): { id: string; after: boolean } => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { id, after: e.clientY > rect.top + rect.height / 2 }
  }

  const finishDrag = (): void => {
    if (dragged && drop) {
      const from = waiting.findIndex((j) => j.id === dragged)
      let to = waiting.findIndex((j) => j.id === drop.id) + (drop.after ? 1 : 0)
      if (to > from) to--
      if (from !== -1 && to !== from) move(dragged, to - from)
    }
    setDragged(null)
    setDrop(null)
  }

  return (
    <div className="overlay-backdrop" onMouseDown={close}>
      <div
        className="transcribe-dialog queue"
        role="dialog"
        aria-label="Transcription queue"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <h2>Transcription queue</h2>
        <p className="muted">
          One recording at a time, so the laptop stays usable. A stopped one keeps what it finished
          (saved every 5 minutes of recording) and goes on from there when you start it again with
          the same language and speed.
        </p>
        {!current && !waiting.length && !pending?.notes.length && (
          <p>Nothing left to transcribe.</p>
        )}
        <ol className="queue-list">
          {current && (
            <li className="queue-item" aria-label={current.name}>
              <span className="queue-name">
                <strong>{current.name}</strong>
                <span className="muted">{jobDetails(current)}</span>
                <span>Now {progressText(current)}</span>
              </span>
              <button className="button" onClick={() => cancel(current.id)}>
                Stop
              </button>
            </li>
          )}
          {waiting.map((job, i) => (
            <li
              key={job.id}
              className={[
                'queue-item',
                dragged === job.id ? 'dragging' : '',
                drop?.id === job.id && dragged !== job.id
                  ? drop.after
                    ? 'drop-after'
                    : 'drop-before'
                  : ''
              ].join(' ')}
              aria-label={job.name}
              title="Drag to change the order"
              draggable={waiting.length > 1}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', job.id)
                setDragged(job.id)
              }}
              onDragOver={(e) => {
                if (!dragged) return
                e.preventDefault()
                const next = dropOn(e, job.id)
                if (drop?.id !== next.id || drop.after !== next.after) setDrop(next)
              }}
              onDrop={(e) => {
                e.preventDefault()
                finishDrag()
              }}
              onDragEnd={() => {
                setDragged(null)
                setDrop(null)
              }}
            >
              <span className="queue-name">
                <strong>{job.name}</strong>
                <span className="muted">{jobDetails(job)}</span>
                <span>{i === 0 ? 'Next' : `Waiting, ${i + 1} in line`}</span>
              </span>
              <button
                className="icon-button"
                title="Sooner"
                aria-label="Sooner"
                disabled={i === 0}
                onClick={() => move(job.id, -1)}
              >
                <Icon name="up" />
              </button>
              <button
                className="icon-button"
                title="Later"
                aria-label="Later"
                disabled={i === waiting.length - 1}
                onClick={() => move(job.id, 1)}
              >
                <Icon name="down" />
              </button>
              <button className="text-button" onClick={() => cancel(job.id)}>
                Remove
              </button>
            </li>
          ))}
        </ol>
        {!!pending?.notes.length && (
          <>
            <h3 className="queue-heading">Not started ({pending.notes.length})</h3>
            <p className="muted">{notStartedReason(pending)}</p>
            <ol className="queue-list">
              {pending.notes.map((note) => (
                <li key={note} className="queue-item" aria-label={noteName(note)}>
                  <span className="queue-name">
                    <strong>{noteName(note)}</strong>
                    <span className="muted">{note.split('/').slice(0, -1).join(' / ')}</span>
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
        <div className="transcribe-actions">
          {!!pending?.notes.length && (
            <button className="button primary" disabled={starting} onClick={startAll}>
              Transcribe all now
            </button>
          )}
          <button className="button" autoFocus onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
