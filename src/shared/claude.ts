/** Types shared by the Claude service in main and the chat panel in the renderer. */

export const MODELS = ['default', 'opus', 'sonnet', 'haiku'] as const
export type ModelChoice = (typeof MODELS)[number]

export const EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type EffortChoice = (typeof EFFORTS)[number]

export interface ClaudeSettings {
  model: ModelChoice
  effort: EffortChoice
  /** Edits show as a preview with Accept / Reject before they are applied. */
  askBeforeEditing: boolean
  /**
   * Claude opens a file it changes or looks at when it is not open yet. Off: my view stays,
   * and clicking the change in the chat opens it.
   */
  openEditedFiles: boolean
  webSearch: boolean
  /** My own words added to every Claude prompt (chat, /claude and the terminal). */
  instructions: string
  /** An API key is stored; it is never sent back to the renderer. */
  hasApiKey: boolean
}

export type ClaudeSettingsUpdate = Partial<Omit<ClaudeSettings, 'hasApiKey'>> & {
  /** A new key, or null to remove the stored one. */
  apiKey?: string | null
}

export const DEFAULT_CLAUDE_SETTINGS: ClaudeSettings = {
  model: 'default',
  effort: 'default',
  askBeforeEditing: true,
  openEditedFiles: false,
  webSearch: false,
  instructions: '',
  hasApiKey: false
}

export interface ChatImage {
  mediaType: 'image/png' | 'image/jpeg'
  data: Uint8Array
}

export interface ChatRequest {
  /** Chat key: the vault path of the section the conversation belongs to. */
  chat: string
  /** The question, with the context packet in front of it. */
  text: string
  images: ChatImage[]
  /** The packet carried my changes to /uml's diagrams (PlaybookContext.offer): seen once answered. */
  offer?: string
}

export interface CompleteRequest {
  /** Chosen by the renderer, to cancel this one request. */
  id: string
  /** The note or PDF it writes in, for Claude's memory of that course. */
  file?: string
  text: string
  images: ChatImage[]
}

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; input: Record<string, unknown> }
  | { type: 'done'; error?: string }

/** A folder with a conversation, for the chat picker. */
export interface ChatInfo {
  folder: string
  /** When it was last written to (ms), when known. */
  updated: number | null
}

export interface ChatHistoryItem {
  role: 'user' | 'assistant'
  text: string
}

/** A call from Claude to one of the app tools, answered by the renderer. */
export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolReply {
  id: string
  ok: boolean
  text: string
  image?: ChatImage
  /** A canvas Claude changed, before and after (JSON Canvas text), so my later edits show. */
  drawn?: { path: string; before: string; after: string }
}

/** What a skill that learns (/uml) knows of one course (see PlaybookStore in main). */
export interface Playbook {
  /** What the lecturer does, learned from the files of the course. */
  text: string
  /** My rules, from what I told it and how I changed its diagrams; they come first. */
  rules: string
  /** It learns this course: all files once, then what is new or changed. */
  learning: boolean
  /** Files of the course it took in, of all of them. */
  learned: number
  total: number
  /** Files not taken in yet, or changed since, in the order of the course. */
  pending: string[]
  /** What the last runs learned, newest first. */
  log: LearnLog[]
  /** Why the last run stopped early. */
  error: string | null
}

export interface LearnLog {
  at: number
  lesson: string
  summary: string
}

/** A learning run going on. */
export interface LearnStatus {
  skill: string
  course: string
  lesson: string
  /** Lessons done of this run, and how many it has. */
  done: number
  total: number
}

/** The playbook as a /uml message gets it, with my changes to its diagrams not seen yet. */
export interface PlaybookContext {
  text: string
  rules: string
  /** This message started learning the course (the first /uml in it). */
  started: boolean
  pending: number
  edits: { path: string; changes: string[] }[]
  /** Hand back with the message (ChatRequest.offer) so `edits` count as seen once answered. */
  offer: string | null
}

/** The context packet travels in front of each question, between these markers. */
export const CONTEXT_START = '<context>'
export const CONTEXT_END = '</context>'

/** The question without the context packet, for showing earlier messages. */
export function stripContext(text: string): string {
  const end = text.indexOf(CONTEXT_END)
  if (!text.startsWith(CONTEXT_START) || end === -1) return text
  return text.slice(end + CONTEXT_END.length).trim()
}
