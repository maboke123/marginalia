import { promises as fs } from 'fs'
import type { LearnStatus } from '../../shared/claude'
import { VaultError } from '../vault/names'
import type { Vault } from '../vault/vault'
import type { Learn, LearnInput } from './agent'
import {
  courseSources,
  editsOf,
  editsTaken,
  LEARNING_SKILLS,
  lessonsOf,
  notLearned,
  type Pending,
  type PlaybookStore,
  type SourceKind
} from './playbook'
import type { CallTool } from './tools'

export type LessonFile = Pending & { edits: string[] | null }

const KIND: Record<SourceKind, string> = {
  pdf: 'slides or other PDF',
  transcript: 'transcript',
  note: 'my note',
  canvas: 'my diagram'
}

const WHY: Record<Pending['why'], string> = {
  new: 'new',
  changed: 'changed since you read it',
  annotations: 'only my annotations on it changed'
}

/** The message of a learning run: the files of one lesson, the playbook so far, my rules. */
export function learnMessage(input: {
  course: string
  folder: string
  files: LessonFile[]
  playbook: string
  rules: string
}): string {
  const lines = [`Course: ${input.course}. Lesson: ${input.folder}.`, '', 'Files to take in:']
  for (const f of input.files) {
    if (f.kind === 'canvas' && f.edits) {
      const all = f.why === 'new' ? ' (not taken in before: read all of it with read_canvas)' : ''
      lines.push(`- ${f.path}: a canvas you drew${all}. What I changed since:`)
      lines.push(...f.edits.map((e) => `    - ${e}`))
    } else {
      lines.push(`- ${f.path} (${KIND[f.kind]}, ${WHY[f.why]})`)
    }
  }
  lines.push(
    '',
    'The playbook so far:',
    '<playbook>',
    input.playbook.trim() || '(empty: this is the first lesson you take in)',
    '</playbook>',
    '',
    'My rules:',
    '<rules>',
    input.rules.trim() || '(none yet)',
    '</rules>'
  )
  return lines.join('\n')
}

interface LearnerDeps {
  playbooks: PlaybookStore
  vault(): Vault | null
  learn(): Promise<Learn | undefined>
  /** The app tools for a run, with this course as the default. */
  tools(signal: AbortSignal, course: string): CallTool
  input(course: string): Promise<Pick<LearnInput, 'settings' | 'memory' | 'apiKey'>>
  emit(status: LearnStatus | null): void
}

/**
 * Takes in the files of a course for a skill that learns, one lesson per Claude run and apart
 * from the chat, saving after each lesson. One course at a time.
 */
export class Learner {
  private current: { status: LearnStatus; controller: AbortController } | null = null

  constructor(private deps: LearnerDeps) {}

  status(): LearnStatus | null {
    return this.current?.status ?? null
  }

  stop(): void {
    this.current?.controller.abort()
  }

  /** What is not learned yet; with `now`, only files that settled by then (Source.settled). */
  async pending(vault: Vault, skill: string, course: string, now = Infinity): Promise<Pending[]> {
    const [sources, state] = await Promise.all([
      courseSources(vault, course),
      this.deps.playbooks.state(skill, course)
    ])
    return notLearned(sources, state.learned).filter(
      (p) => now === Infinity || sources[p.path].settled <= now
    )
  }

  /**
   * Learns what is pending; `settled` leaves out files that changed just now (slides and
   * transcripts 10 minutes, notes, canvases and annotations an hour).
   */
  async run(skill: string, course: string, settled: boolean): Promise<void> {
    if (this.current) {
      if (this.current.status.course === course && this.current.status.skill === skill) return
      throw new VaultError(`Still learning ${this.current.status.course}`)
    }
    const vault = this.deps.vault()
    if (!vault) throw new VaultError('No vault is open')
    const learn = await this.deps.learn()
    if (!learn) throw new VaultError('Learning is not available')
    const controller = new AbortController()
    const status: LearnStatus = { skill, course, lesson: '', done: 0, total: 0 }
    this.current = { status, controller }
    const { playbooks } = this.deps
    try {
      const pending = await this.pending(vault, skill, course, settled ? Date.now() : Infinity)
      const lessons = lessonsOf(pending)
      for (const [i, lesson] of lessons.entries()) {
        if (controller.signal.aborted || this.deps.vault() !== vault) break
        this.current.status = { ...status, lesson: lesson.folder, done: i, total: lessons.length }
        this.deps.emit(this.current.status)
        await this.lesson(vault, learn, skill, course, lesson, controller.signal)
      }
      if (lessons.length && !controller.signal.aborted) {
        await playbooks.update(skill, course, (s) => ({ ...s, error: null }))
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const error = (err as Error).message || String(err)
        console.error('[learn]', error)
        await playbooks.update(skill, course, (s) => ({ ...s, error })).catch(() => {})
      }
    } finally {
      this.current = null
      this.deps.emit(null)
    }
  }

  private async lesson(
    vault: Vault,
    learn: Learn,
    skill: string,
    course: string,
    lesson: { folder: string; files: Pending[] },
    signal: AbortSignal
  ): Promise<void> {
    const { playbooks } = this.deps
    // Stamps from now: a file I change during the run is learned again later.
    const sources = await courseSources(vault, course)
    const state = await playbooks.state(skill, course)
    const canvases: Record<string, string> = {}
    const files: LessonFile[] = []
    for (const file of lesson.files.filter((f) => sources[f.path])) {
      if (file.kind !== 'canvas') {
        files.push({ ...file, edits: null })
        continue
      }
      const text = await fs.readFile(vault.resolve(file.path), 'utf8').catch(() => '')
      canvases[file.path] = text
      const edits = editsOf(state, file.path, text)
      // A canvas Claude drew and I left alone teaches nothing.
      if (!edits || edits.length) files.push({ ...file, edits })
    }
    let summary = ''
    if (files.length) {
      const [playbook, rules] = await Promise.all([
        playbooks.read(skill, course, 'text'),
        playbooks.read(skill, course, 'rules')
      ])
      summary = await learn({
        cwd: vault.root,
        text: learnMessage({ course, folder: lesson.folder, files, playbook, rules }),
        ...(await this.deps.input(course)),
        callTool: this.deps.tools(signal, course),
        signal
      })
    }
    if (signal.aborted) return
    await playbooks.update(skill, course, (s) => {
      const next = editsTaken(s, canvases)
      const learned = { ...next.learned }
      for (const file of lesson.files) {
        if (sources[file.path]) learned[file.path] = sources[file.path].stamp
      }
      const log = files.length
        ? [{ at: Date.now(), lesson: lesson.folder, summary: summary.trim().slice(0, 1500) }]
        : []
      return { ...next, learned, log: [...log, ...next.log] }
    })
  }

  /** For each course being learned: what has settled since the last time. */
  async tick(): Promise<void> {
    if (this.current || !this.deps.vault()) return
    for (const skill of LEARNING_SKILLS) {
      for (const course of await this.deps.playbooks.learning(skill)) {
        await this.run(skill, course, true).catch((err) => console.error('[learn]', err))
      }
    }
  }
}
