import { promises as fs } from 'fs'
import path from 'path'
import { canvasFrom } from '../../shared/canvas'
import { canvasEdits } from '../../shared/canvasEdits'
import type { LearnLog } from '../../shared/claude'
import type { VaultNode } from '../../shared/types'
import { NOT_TRANSCRIBED, untranscribed } from '../transcribe/transcript'
import { writeFileAtomic } from '../vault/atomic'
import { validateName, VaultError } from '../vault/names'
import type { Vault } from '../vault/vault'

/** A playbook goes into the prompt only when its skill runs, so it may be longer than memory. */
export const MAX_PLAYBOOK = 20_000
export const MAX_RULES = 6000
const MAX_LOG = 10

/** The skills that learn a course from its files, and from my feedback. */
export const LEARNING_SKILLS = ['uml']

export type Part = 'text' | 'rules'

/** What the store keeps per course besides the two texts. */
export interface CourseState {
  learning: boolean
  /** Vault path -> stamp of the version taken in. */
  learned: Record<string, string>
  /** Canvas vault path -> that canvas as Claude left it, or as it was when last taken in. */
  drawn: Record<string, string>
  /** My changes to a canvas from before Claude changed it again, not taken in yet. */
  edits: Record<string, string[]>
  log: LearnLog[]
  error: string | null
}

const EMPTY_STATE: CourseState = {
  learning: false,
  learned: {},
  drawn: {},
  edits: {},
  log: [],
  error: null
}

function stateFrom(raw: unknown): CourseState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const record = <T>(v: unknown): Record<string, T> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : {}
  return {
    learning: r.learning === true,
    learned: record(r.learned),
    drawn: record(r.drawn),
    edits: record(r.edits),
    log: Array.isArray(r.log) ? r.log.slice(0, MAX_LOG) : [],
    error: typeof r.error === 'string' ? r.error : null
  }
}

async function readText(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return ''
  }
}

async function writeText(file: string, text: string, max: number): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) {
    await fs.rm(file, { force: true })
    return
  }
  await fs.mkdir(path.dirname(file), { recursive: true })
  await writeFileAtomic(file, trimmed.slice(0, max) + '\n')
}

// Who a rule comes from when it is not me: "- No getters (from the TA, project feedback)".
const FROM = /\s*\(from [^()]*\)$/

const ruleKey = (line: string): string =>
  line
    .replace(/^\s*[-*]\s+/, '')
    .replace(FROM, '')
    .trim()
    .toLowerCase()

/**
 * My rules with one added, or with the rule `replaces` names changed (an empty rule removes
 * it). `from` says who it comes from when it is not me (the lecturer, a TA). A rule that is
 * there already is not added twice; given again, it takes the new source.
 */
export function withRule(
  rules: string,
  rule: string,
  replaces?: string,
  from?: string
): { rules: string; found: boolean } {
  const lines = rules.trimEnd() ? rules.trimEnd().split('\n') : []
  const words = rule
    .trim()
    .replace(/^[-*]\s+/, '')
    .replace(FROM, '')
  const source = from?.trim().replace(/^from\s+/i, '')
  const next = words && `- ${words}${source ? ` (from ${source})` : ''}`
  const target = replaces?.trim() ? ruleKey(replaces) : ''
  const at = target
    ? lines.findIndex(
        (l) => ruleKey(l) === target || (target.length >= 8 && ruleKey(l).includes(target))
      )
    : -1
  const same = next ? lines.findIndex((l) => ruleKey(l) === ruleKey(next)) : -1
  if (at !== -1) {
    if (next) lines[at] = next
    else lines.splice(at, 1)
    // The new words were there already as another rule: keep one.
    if (next && same !== -1 && same !== at) lines.splice(same, 1)
  } else if (same !== -1) {
    lines[same] = next
  } else if (next) {
    lines.push(next)
  }
  return { rules: lines.length ? lines.join('\n') + '\n' : '', found: !target || at !== -1 }
}

/**
 * What a skill learned per course, kept outside the vault like the memory, in
 * `<skill>/courses/`: `<course>.md` (what the lecturer does), `<course>.rules.md` (my rules)
 * and `<course>.json` (which files it took in, the canvases it drew, what the last runs did).
 */
export class PlaybookStore {
  // The learner and the chat both write; one change at a time per course.
  private queues = new Map<string, Promise<unknown>>()

  constructor(readonly dir: string) {}

  private file(skill: string, course: string, ending: '.md' | '.rules.md' | '.json'): string {
    if (!LEARNING_SKILLS.includes(skill)) throw new VaultError(`/${skill} does not learn`)
    if (!course) throw new VaultError('A playbook belongs to a course')
    return path.join(this.dir, skill, 'courses', `${validateName(course)}${ending}`)
  }

  private serial<T>(skill: string, course: string, fn: () => Promise<T>): Promise<T> {
    const key = `${skill}/${course}`
    const next = (this.queues.get(key) ?? Promise.resolve()).then(fn, fn)
    this.queues.set(
      key,
      next.catch(() => {})
    )
    return next
  }

  async read(skill: string, course: string, part: Part): Promise<string> {
    if (!course) return ''
    return readText(this.file(skill, course, part === 'text' ? '.md' : '.rules.md'))
  }

  async write(skill: string, course: string, part: Part, text: string): Promise<void> {
    const file = this.file(skill, course, part === 'text' ? '.md' : '.rules.md')
    await this.serial(skill, course, () =>
      writeText(file, text, part === 'text' ? MAX_PLAYBOOK : MAX_RULES)
    )
  }

  async addRule(
    skill: string,
    course: string,
    rule: string,
    replaces?: string,
    from?: string
  ): Promise<{ rules: string; found: boolean }> {
    const file = this.file(skill, course, '.rules.md')
    return this.serial(skill, course, async () => {
      const next = withRule(await readText(file), rule, replaces, from)
      await writeText(file, next.rules, MAX_RULES)
      return next
    })
  }

  async state(skill: string, course: string): Promise<CourseState> {
    if (!course) return EMPTY_STATE
    const text = await readText(this.file(skill, course, '.json'))
    try {
      return stateFrom(text ? JSON.parse(text) : {})
    } catch {
      return EMPTY_STATE
    }
  }

  async update(
    skill: string,
    course: string,
    fn: (state: CourseState) => CourseState | Promise<CourseState>
  ): Promise<CourseState> {
    const file = this.file(skill, course, '.json')
    return this.serial(skill, course, async () => {
      const next = await fn(await this.state(skill, course))
      next.log = next.log.slice(0, MAX_LOG)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await writeFileAtomic(file, JSON.stringify(next, null, 2) + '\n')
      return next
    })
  }

  /** The courses a skill is learning. */
  async learning(skill: string): Promise<string[]> {
    const courses = await this.courses(skill)
    const states = await Promise.all(courses.map((c) => this.state(skill, c)))
    return courses.filter((_, i) => states[i].learning)
  }

  /** The courses a skill keeps anything for. */
  private async courses(skill: string): Promise<string[]> {
    const names = await fs.readdir(path.join(this.dir, skill, 'courses')).catch(() => [])
    const course = (n: string): string => n.replace(/(\.rules\.md|\.md|\.json)$/, '')
    return [...new Set(names.map(course))]
  }

  /**
   * Keeps what was learned attached to files and folders of the vault that were renamed, moved
   * or trashed; a renamed notebook takes its playbook, rules and state along.
   */
  async remap(from: string, to: string | null): Promise<void> {
    for (const skill of LEARNING_SKILLS) {
      const courses = await this.courses(skill)
      const notebook = to && !from.includes('/') && !to.includes('/')
      if (notebook && courses.includes(from) && !courses.includes(to)) {
        await this.serial(skill, from, async () => {
          for (const ending of ['.md', '.rules.md', '.json'] as const) {
            await fs
              .rename(this.file(skill, from, ending), this.file(skill, to, ending))
              .catch(() => {})
          }
        })
        courses[courses.indexOf(from)] = to
      }
      for (const course of courses) {
        const state = await this.state(skill, course)
        if (!remapCourse(state, course, from, to)) continue
        await this.update(skill, course, (s) => remapCourse(s, course, from, to) ?? s)
      }
    }
  }
}

/**
 * The state with paths under `from` moved to `to`; those that leave the course or were
 * trashed go (another course takes them in as new). Null when nothing changed.
 */
export function remapCourse(
  state: CourseState,
  course: string,
  from: string,
  to: string | null
): CourseState | null {
  let changed = false
  const move = <T>(record: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {}
    for (const [key, value] of Object.entries(record)) {
      if (key !== from && !key.startsWith(`${from}/`)) {
        out[key] = value
        continue
      }
      changed = true
      const next = to && to + key.slice(from.length)
      if (next && next.split('/')[0] === course) out[next] = value
    }
    return out
  }
  const next = {
    ...state,
    learned: move(state.learned),
    drawn: move(state.drawn),
    edits: move(state.edits)
  }
  return changed ? next : null
}

export type SourceKind = 'pdf' | 'transcript' | 'note' | 'canvas'

export interface Source {
  kind: SourceKind
  /** Changes when the file does; for a PDF also when my annotations on it do. */
  stamp: string
  /** From when (ms) it is learned by itself: a while after its last change. */
  settled: number
}

/** New slides and transcripts arrive whole: they are taken in soon. */
export const ARRIVE_MS = 10 * 60_000
/** Notes, canvases and annotations I may still be working on: an hour after the last change. */
export const SETTLE_MS = 60 * 60_000

const TRANSCRIPT = /(^|\/)Transcript [^/]*\.md$/

const stampOf = (stat: { size: number; mtimeMs: number }): string =>
  `${stat.size}-${Math.round(stat.mtimeMs)}`

/**
 * Every file of a course (a notebook) to learn from, in the order of the sidebar: slides and
 * other PDFs, transcripts, notes and canvases. Transcripts without text yet and empty notes
 * are left out.
 */
export async function courseSources(vault: Vault, course: string): Promise<Record<string, Source>> {
  const { nodes } = await vault.tree()
  const files: VaultNode[] = []
  const walk = (list: VaultNode[]): void => {
    for (const node of list) {
      if (node.children) walk(node.children)
      else if (node.kind === 'pdf' || node.kind === 'markdown' || node.kind === 'canvas') {
        files.push(node)
      }
    }
  }
  walk(nodes.find((n) => n.path === course)?.children ?? [])
  const out: Record<string, Source> = {}
  for (const node of files) {
    const file = vault.resolve(node.path)
    const stat = await fs.stat(file).catch(() => null)
    if (!stat) continue
    if (node.kind === 'pdf') {
      const sidecar = await fs.stat(`${file}.annotations.json`).catch(() => null)
      out[node.path] = {
        kind: 'pdf',
        stamp: `${stampOf(stat)}|${sidecar ? stampOf(sidecar) : ''}`,
        settled: Math.max(stat.mtimeMs + ARRIVE_MS, sidecar ? sidecar.mtimeMs + SETTLE_MS : 0)
      }
    } else {
      if (node.kind === 'markdown') {
        const text = await fs.readFile(file, 'utf8').catch(() => '')
        if (!text.trim() || text.includes(NOT_TRANSCRIBED) || untranscribed(text)) continue
      }
      const kind =
        node.kind === 'canvas' ? 'canvas' : TRANSCRIPT.test(node.path) ? 'transcript' : 'note'
      out[node.path] = {
        kind,
        stamp: stampOf(stat),
        settled: stat.mtimeMs + (kind === 'transcript' ? ARRIVE_MS : SETTLE_MS)
      }
    }
  }
  return out
}

export interface Pending {
  path: string
  kind: SourceKind
  /** Never taken in, changed since, or (a PDF) only my annotations on it changed. */
  why: 'new' | 'changed' | 'annotations'
}

/** Files of the course not taken in yet, or changed since, in the order of the course. */
export function notLearned(
  sources: Record<string, Source>,
  learned: Record<string, string>
): Pending[] {
  const out: Pending[] = []
  for (const [file, source] of Object.entries(sources)) {
    const before = learned[file]
    if (before === source.stamp) continue
    const why = !before
      ? 'new'
      : source.kind === 'pdf' && before.split('|')[0] === source.stamp.split('|')[0]
        ? 'annotations'
        : 'changed'
    out.push({ path: file, kind: source.kind, why })
  }
  return out
}

/** Pending files grouped per lesson (their folder), in the order of the course. */
export function lessonsOf(pending: Pending[]): { folder: string; files: Pending[] }[] {
  const out: { folder: string; files: Pending[] }[] = []
  for (const file of pending) {
    const folder = file.path.split('/').slice(0, -1).join('/')
    const lesson = out.find((l) => l.folder === folder)
    if (lesson) lesson.files.push(file)
    else out.push({ folder, files: [file] })
  }
  return out
}

/**
 * My changes to a canvas Claude drew, since it drew it or since they were last taken in.
 * Null when Claude never drew on it: then the whole canvas is mine.
 */
export function editsOf(state: CourseState, file: string, current: string): string[] | null {
  const drawn = state.drawn[file]
  if (drawn === undefined) return null
  let since: string[] = []
  try {
    since = canvasEdits(canvasFrom(drawn), canvasFrom(current))
  } catch {
    // A damaged canvas shows no changes; it is read as it is.
  }
  return [...(state.edits[file] ?? []), ...since]
}

/** The state after Claude changed a canvas: my changes before it are kept for later. */
export function afterDrawing(
  state: CourseState,
  file: string,
  before: string,
  after: string
): CourseState {
  const mine = editsOf(state, file, before) ?? []
  const edits = { ...state.edits }
  if (mine.length) edits[file] = mine
  else delete edits[file]
  return { ...state, drawn: { ...state.drawn, [file]: after }, edits }
}

/** The state once my changes to these canvases are taken in. */
export function editsTaken(state: CourseState, current: Record<string, string>): CourseState {
  const drawn = { ...state.drawn }
  const edits = { ...state.edits }
  for (const [file, text] of Object.entries(current)) {
    if (drawn[file] === undefined) continue
    drawn[file] = text
    delete edits[file]
  }
  return { ...state, drawn, edits }
}
