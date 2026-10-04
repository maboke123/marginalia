import { promises as fs } from 'fs'
import type { FeedbackEntry } from '../shared/types'

const HEADER =
  '# Marginalia feedback\n\nThings that went wrong or should change, newest at the bottom. ' +
  'Tick an item when it is fixed.\n'

const pad = (n: number): string => String(n).padStart(2, '0')

/** One checklist item: time and what was open on the first line, my text indented below. */
export function formatFeedback(entry: FeedbackEntry, now: Date): string {
  const when = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  const where = entry.context ? ` · ${entry.context}` : ''
  const body = entry.text
    .trim()
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `  ${line}` : ''))
    .join('\n')
  return `\n- [ ] **${when}**${where}\n${body}\n`
}

/** Appends, never rewrites, so earlier entries cannot get lost. */
export async function appendFeedback(
  file: string,
  entry: FeedbackEntry,
  now = new Date()
): Promise<void> {
  const exists = await fs.stat(file).then(
    () => true,
    () => false
  )
  await fs.appendFile(file, (exists ? '' : HEADER) + formatFeedback(entry, now), 'utf8')
}

/** Creates the file with its header when it is not there yet, so it can be opened. */
export async function ensureFeedbackFile(file: string): Promise<void> {
  await fs.writeFile(file, HEADER, { flag: 'wx' }).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'EEXIST') throw err
  })
}
