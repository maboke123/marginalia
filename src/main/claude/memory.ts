import { promises as fs } from 'fs'
import path from 'path'
import { writeFileAtomic } from '../vault/atomic'
import { validateName } from '../vault/names'

/** Longer notes would crowd every prompt; Claude is asked to keep them far shorter. */
export const MAX_MEMORY = 8000

/**
 * What Claude learned about me, kept outside the vault so it never syncs or ends up in a repo:
 * `me.md` for everything, and one note per course (notebook) in `courses/`.
 * The key of a course note is the notebook name; '' is the note about me.
 */
export class MemoryStore {
  constructor(readonly dir: string) {}

  fileOf(course: string): string {
    return course
      ? path.join(this.dir, 'courses', `${validateName(course)}.md`)
      : path.join(this.dir, 'me.md')
  }

  async read(course: string): Promise<string> {
    try {
      return await fs.readFile(this.fileOf(course), 'utf8')
    } catch {
      return ''
    }
  }

  async write(course: string, text: string): Promise<void> {
    const file = this.fileOf(course)
    const trimmed = text.trim()
    if (!trimmed) {
      await fs.rm(file, { force: true })
      return
    }
    await fs.mkdir(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, trimmed.slice(0, MAX_MEMORY) + '\n')
  }

  /** Every note there is: '' (about me) first, then the courses that have one. */
  async all(): Promise<Record<string, string>> {
    const out: Record<string, string> = { '': await this.read('') }
    let names: string[] = []
    try {
      names = await fs.readdir(path.join(this.dir, 'courses'))
    } catch {
      // No course notes yet.
    }
    for (const name of names.filter((n) => n.endsWith('.md')).sort()) {
      const course = name.slice(0, -3)
      out[course] = await this.read(course)
    }
    return out
  }
}

/** The course of a vault folder: its notebook, the first folder ('' for the vault root). */
export function courseOf(folder: string): string {
  return folder.split('/')[0]
}

/** The course of a file, like ML for ML/B2/slides.pdf ('' for Todo.md in the root). */
export function courseOfFile(file: string): string {
  const parts = file.split('/')
  return parts.length > 1 ? parts[0] : ''
}
