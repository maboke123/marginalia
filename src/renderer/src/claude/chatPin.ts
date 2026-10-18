import type { ChatInfo } from '../../../shared/claude'

/**
 * A chat the panel keeps showing while I look at files in `scope` (a folder, '' for the whole
 * vault), instead of switching to the chat of each file's folder. Null scope: only while it
 * answers.
 */
export interface Pin {
  chat: string
  scope: string | null
}

export const within = (folder: string, scope: string): boolean =>
  scope === '' || folder === scope || folder.startsWith(`${scope}/`)

/** The deepest folder holding both. */
export function commonFolder(a: string, b: string): string {
  const x = a.split('/')
  const y = b.split('/')
  let i = 0
  while (i < x.length && i < y.length && x[i] === y[i]) i++
  return x.slice(0, i).join('/')
}

/** The chat to show: the one answering, the pinned one, else the chat of what I look at. */
export function shownChat(viewed: string, pin: Pin | null, running: string | null): string {
  if (pin && running !== null && pin.chat === running) return running
  if (pin && pin.scope !== null && within(viewed, pin.scope)) return pin.chat
  return viewed
}

/**
 * Picking a chat keeps it while I stay near both it and what I was looking at: the chat of
 * the assignment folder stays while I work on the report in its subfolder.
 */
export function pickPin(chat: string, viewed: string): Pin | null {
  if (chat === viewed) return null
  return { chat, scope: commonFolder(chat, viewed) }
}

/**
 * Asking something keeps that chat while I open files below its folder, and while it answers,
 * also when Claude opens a file somewhere else.
 */
export function sendPin(chat: string, pin: Pin | null): Pin {
  if (pin?.chat === chat) return pin
  return { chat, scope: chat === '' ? null : chat }
}

export interface ChatGroup {
  label: string
  chats: ChatInfo[]
}

const newest = (a: ChatInfo, b: ChatInfo): number => (b.updated ?? 0) - (a.updated ?? 0)
const notebookOf = (folder: string): string => folder.split('/')[0]

/** The chats to pick from, nearest first: this folder, above, below, the course, the rest. */
export function chatGroups(viewed: string, chats: ChatInfo[]): ChatGroup[] {
  const here = chats.find((c) => c.folder === viewed) ?? { folder: viewed, updated: null }
  const others = chats.filter((c) => c.folder !== viewed)
  const above = others
    .filter((c) => within(viewed, c.folder))
    .sort((a, b) => b.folder.length - a.folder.length)
  const below = others.filter((c) => c.folder !== '' && within(c.folder, viewed)).sort(newest)
  const near = new Set([...above, ...below])
  const rest = others.filter((c) => !near.has(c))
  const course = rest.filter((c) => viewed && notebookOf(c.folder) === notebookOf(viewed))
  const elsewhere = rest.filter((c) => !course.includes(c)).sort(newest)
  return [
    { label: 'This folder', chats: [here] },
    { label: 'Folders above', chats: above },
    { label: 'Folders below', chats: below },
    { label: 'This course', chats: course.sort(newest) },
    { label: 'Other courses', chats: elsewhere }
  ].filter((g) => g.chats.length)
}
