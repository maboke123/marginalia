import { promises as fs } from 'fs'
import path from 'path'
import type { VaultNode } from '../../shared/types'
import { writeFileAtomic } from '../vault/atomic'
import { validateName, VaultError } from '../vault/names'
import type { Vault } from '../vault/vault'
import { MemoryStore } from './memory'

/** A playbook goes into the prompt only when its skill runs, so it may be longer than memory. */
export const MAX_PLAYBOOK = 20_000

/** The skills that learn a course from its slides and transcripts, and from my feedback. */
export const LEARNING_SKILLS = ['uml']

/**
 * What a skill learned per course, kept outside the vault like the memory:
 * `<skill>/courses/<course>.md`, and next to it `<course>.learned.json`, the files of the
 * course it has read (vault path -> stamp), so a changed or new file is learned again.
 */
export class PlaybookStore {
  constructor(readonly dir: string) {}

  private notes(skill: string): MemoryStore {
    if (!LEARNING_SKILLS.includes(skill)) throw new VaultError(`/${skill} does not learn`)
    return new MemoryStore(path.join(this.dir, skill), MAX_PLAYBOOK)
  }

  private learnedFile(skill: string, course: string): string {
    return path.join(this.notes(skill).dir, 'courses', `${validateName(course)}.learned.json`)
  }

  async read(skill: string, course: string): Promise<string> {
    return course ? this.notes(skill).read(course) : ''
  }

  async write(skill: string, course: string, text: string): Promise<void> {
    if (!course) throw new VaultError('A playbook belongs to a course')
    await this.notes(skill).write(course, text)
  }

  async learned(skill: string, course: string): Promise<Record<string, string>> {
    if (!course) return {}
    try {
      const value = JSON.parse(await fs.readFile(this.learnedFile(skill, course), 'utf8'))
      return value && typeof value === 'object' ? value : {}
    } catch {
      return {}
    }
  }

  async markLearned(skill: string, course: string, stamps: Record<string, string>): Promise<void> {
    const file = this.learnedFile(skill, course)
    const next = { ...(await this.learned(skill, course)), ...stamps }
    await fs.mkdir(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, JSON.stringify(next, null, 2) + '\n')
  }
}

const TRANSCRIPT = /(^|\/)Transcript [^/]*\.md$/

/**
 * The slide decks and transcripts of a course (a notebook), in the order of the sidebar, with
 * a stamp that changes when the file does.
 */
export async function courseSources(vault: Vault, course: string): Promise<Record<string, string>> {
  const { nodes } = await vault.tree()
  const files: string[] = []
  const walk = (list: VaultNode[]): void => {
    for (const node of list) {
      if (node.children) walk(node.children)
      else if (node.kind === 'pdf' || TRANSCRIPT.test(node.path)) files.push(node.path)
    }
  }
  walk(nodes.find((n) => n.path === course)?.children ?? [])
  const out: Record<string, string> = {}
  for (const file of files) {
    const stat = await fs.stat(vault.resolve(file)).catch(() => null)
    if (stat) out[file] = `${stat.size}-${Math.round(stat.mtimeMs)}`
  }
  return out
}

/** Files of the course not learned yet, or changed since, in the order of the course. */
export function notLearned(
  sources: Record<string, string>,
  learned: Record<string, string>
): string[] {
  return Object.keys(sources).filter((file) => learned[file] !== sources[file])
}
